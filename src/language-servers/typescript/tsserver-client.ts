/**
 * Direct TSServer client implementation
 * Communicates with tsserver using its native protocol for full project awareness
 */

import { ChildProcess, spawn } from 'child_process';
import { readFile, readdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { logger } from '../../utils/logger.js';

export interface RefactorResult {
  success: boolean;
  message: string;
  filesChanged: Array<{
    file: string;
    path: string;
    edits: Array<{
      line: number;
      column?: number;
      old: string;
      new: string;
    }>;
  }>;
  nextActions?: string[];
  preview?: {
    filesAffected: number;
    estimatedTime: string;
    command: string;
  };
}

interface TSServerRequest {
  seq: number;
  type: 'request';
  command: string;
  arguments?: Record<string, unknown>;
}

interface TSServerResponse {
  seq: number;
  type: 'response' | 'event';
  command?: string;
  request_seq?: number;
  success?: boolean;
  body?: unknown;
  event?: string;
}

export class TypeScriptServer {
  private process: ChildProcess | null = null;
  private seq = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private messageBuffer = '';
  private projectLoaded = false;
  private projectLoadingPromise: Promise<void> | null = null;
  private projectUpdatePromise: Promise<void> | null = null;
  private projectUpdateResolve: (() => void) | null = null;
  private running = false;
  private lastScanTimedOut = false;

  constructor() {}

  isRunning(): boolean {
    return this.running;
  }

  async start(projectPath: string): Promise<void> {
    if (this.running) {
      throw new Error('TypeScript server is already running');
    }

    const tsserverPath = resolve('node_modules/typescript/lib/tsserver.js');

    this.process = spawn('node', [tsserverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectPath,
      env: {
        ...process.env
      }
    });

    this.process.stdout?.setEncoding('utf8');
    this.process.stdout?.on('data', (data) => this.handleData(data));

    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (data) => {
      logger.debug({ stderr: data.toString() }, 'TSServer stderr');
    });

    this.process.on('exit', (code) => {
      logger.info({ code }, 'TSServer process exited');
      this.running = false;
    });

    // Configure preferences
    await this.sendRequest('configure', {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
        allowIncompleteCompletions: true,
        includeAutomaticOptionalChainCompletions: true
      }
    });

    this.running = true;

    // For small/empty projects, projectLoadingStart might not fire
    // If we don't see it within 500ms, assume project is ready
    setTimeout(() => {
      if (!this.projectLoaded && this.running) {
        logger.debug('No project loading event received, assuming small project');
        this.projectLoaded = true;
      }
    }, 500);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.process) {
      return;
    }

    this.process.kill();
    this.process = null;
    this.running = false;
  }

  private handleData(data: string): void {
    this.messageBuffer += data;

    while (true) {
      // Look for Content-Length header
      const headerMatch = this.messageBuffer.match(/Content-Length: (\d+)\r?\n\r?\n/);
      if (!headerMatch) {
        break; // Wait for more data
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerLength = headerMatch[0].length;
      const totalLength = headerLength + contentLength;

      if (this.messageBuffer.length < totalLength) {
        break; // Wait for complete message
      }

      // Extract the JSON body
      const jsonBody = this.messageBuffer.slice(headerLength, totalLength);
      this.messageBuffer = this.messageBuffer.slice(totalLength);

      try {
        const message: TSServerResponse = JSON.parse(jsonBody);
        this.handleMessage(message);
      } catch (error) {
        logger.error({ err: error, body: jsonBody }, 'Failed to parse TSServer message');
      }
    }
  }

  private handleMessage(message: TSServerResponse): void {
    if (message.type === 'event') {
      logger.debug({ event: message.event }, 'TSServer event');
      if (message.event === 'projectLoadingFinish') {
        logger.debug('Project loading finished');
        this.projectLoaded = true;

        if (this.projectLoadingPromise) {
          this.projectLoadingPromise = null;
        }
      } else if (message.event === 'projectLoadingStart') {
        logger.debug('Project loading started');
        this.projectLoaded = false;
      } else if (message.event === 'projectsUpdatedInBackground') {
        logger.debug('Projects updated in background');
        this.projectLoaded = true;

        if (this.projectUpdateResolve) {
          this.projectUpdateResolve();
          this.projectUpdateResolve = null;
          this.projectUpdatePromise = null;
        }
      }
    }

    // Handle responses
    if (message.type === 'response' && message.request_seq) {
      const pending = this.pendingRequests.get(message.request_seq);
      if (pending) {
        this.pendingRequests.delete(message.request_seq);
        if (message.success) {
          pending.resolve(message.body);
        } else {
          const errorMsg = (message.body as { message?: string })?.message || String(message.body) || 'Request failed';
          pending.reject(new Error(errorMsg));
        }
      }
    }
  }

  async sendRequest<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const seq = ++this.seq;
      const request: TSServerRequest = {
        seq,
        type: 'request',
        command,
        arguments: args
      };

      this.pendingRequests.set(seq, { resolve: resolve as (value: unknown) => void, reject });

      const message = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error(`Request ${command} timed out`));
        }
      }, 30000);
    });
  }

  async openFile(filePath: string): Promise<void> {
    const content = await readFile(filePath, 'utf8');
    await this.sendRequest('open', {
      file: filePath,
      fileContent: content
    });
  }

  isProjectLoaded(): boolean {
    return this.projectLoaded;
  }

  didLastScanTimeout(): boolean {
    return this.lastScanTimedOut;
  }

  async checkProjectLoaded(timeout = 5000): Promise<RefactorResult | null> {
    if (this.projectLoaded) return null;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.projectLoaded) {
        logger.info({ duration: Date.now() - startTime }, 'Project loaded');
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Project is still loading after timeout
    return {
      success: false,
      message: `⏳ TypeScript is still indexing the project (waited ${timeout}ms)

💡 Try:
  1. Wait a few more seconds and try again
  2. For large projects, indexing can take 10-30 seconds
  3. Check that tsconfig.json is properly configured`,
      filesChanged: []
    };
  }

  async waitForProjectUpdate(timeout = 5000): Promise<void> {
    if (this.projectLoaded && !this.projectUpdatePromise) {
      return Promise.resolve();
    }

    if (this.projectUpdatePromise) {
      return this.projectUpdatePromise;
    }

    this.projectUpdatePromise = new Promise<void>((resolve, reject) => {
      this.projectUpdateResolve = resolve;

      setTimeout(() => {
        if (this.projectUpdateResolve) {
          this.projectUpdateResolve = null;
          this.projectUpdatePromise = null;
          reject(new Error(`Project update timeout after ${timeout}ms`));
        }
      }, timeout);
    });

    return this.projectUpdatePromise;
  }

  private async scanTypeScriptFiles(dir: string, timeoutMs = 5000): Promise<string[]> {
    const files: string[] = [];
    const startTime = Date.now();
    let timedOut = false;

    const scan = async (currentDir: string): Promise<void> => {
      if (Date.now() - startTime > timeoutMs) {
        timedOut = true;
        logger.debug({ elapsed: Date.now() - startTime, filesFound: files.length }, 'Filesystem scan timeout');
        return;
      }

      try {
        const entries = await readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (Date.now() - startTime > timeoutMs) {
            timedOut = true;
            break;
          }

          const fullPath = join(currentDir, entry.name);

          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist') {
              continue;
            }
            await scan(fullPath);
          } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        logger.debug({ dir: currentDir, error }, 'Failed to scan directory');
      }
    };

    await scan(dir);
    this.lastScanTimedOut = timedOut;

    if (timedOut) {
      logger.debug({ filesFound: files.length, elapsed: Date.now() - startTime }, 'Filesystem scan incomplete (timeout)');
    } else {
      logger.debug({ filesFound: files.length, elapsed: Date.now() - startTime }, 'Filesystem scan complete');
    }

    return files;
  }

  private async waitForFileIndexing(filePath: string, maxAttempts = 30): Promise<{ refs: Array<{ file: string }> } | null> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const refs = await this.sendRequest<{
          refs: Array<{ file: string }>;
        }>('fileReferences', { file: filePath });

        if (refs !== null) {
          logger.debug({ attempt: i + 1, refsCount: refs.refs?.length || 0, file: filePath }, 'File indexed');
          return refs;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return null;
  }

  async discoverAndOpenImportingFiles(filePath: string | string[]): Promise<void> {
    const files = Array.isArray(filePath) ? filePath : [filePath];
    const importingFiles = new Set<string>();

    for (const file of files) {
      const refs = await this.waitForFileIndexing(file);

      if (refs?.refs?.length) {
        logger.debug({ file, importersCount: refs.refs.length }, 'Found files that reference this file');
        refs.refs.forEach(ref => {
          if (ref.file !== file) {
            importingFiles.add(ref.file);
          }
        });
      } else if (!refs || refs.refs.length === 0) {
        logger.debug({ file }, 'File not indexed or has no refs, scanning for undiscovered files');

        const projectInfo = await this.sendRequest<{
          configFileName: string;
          fileNames?: string[];
        }>('projectInfo', {
          file,
          needFileNameList: true
        });

        if (!projectInfo?.configFileName) continue;

        const projectRoot = dirname(projectInfo.configFileName);
        const knownFiles = new Set(projectInfo.fileNames || []);
        const allFiles = await this.scanTypeScriptFiles(projectRoot);

        allFiles
          .filter(f => !knownFiles.has(f) && !files.includes(f))
          .forEach(f => importingFiles.add(f));
      }
    }

    if (importingFiles.size > 0) {
      logger.debug({ count: importingFiles.size }, 'Opening importing files in parallel');

      await Promise.all(
        Array.from(importingFiles).map(file =>
          this.openFile(file).catch(error => {
            logger.debug({ file, error }, 'Failed to open importing file');
          })
        )
      );
    }
  }

}


