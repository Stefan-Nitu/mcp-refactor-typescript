/**
 * Direct TSServer client implementation
 * Communicates with tsserver using its native protocol for full project awareness
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { logger } from '../../utils/logger.js';

export interface RefactorResult {
  success: boolean;
  message: string;
  filesChanged: string[];
  changes: Array<{
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
  private projectPath = '';
  private projectLoaded = false;
  private projectLoadingPromise: Promise<void> | null = null;
  private running = false;

  constructor() {}

  isRunning(): boolean {
    return this.running;
  }

  private errorResult(message: string): RefactorResult {
    return {
      success: false,
      message,
      filesChanged: [],
      changes: []
    };
  }

  private successResult(
    message: string,
    filesChanged: string[],
    changes: RefactorResult['changes']
  ): RefactorResult {
    return {
      success: true,
      message,
      filesChanged,
      changes
    };
  }

  async start(projectPath: string): Promise<void> {
    if (this.running) {
      throw new Error('TypeScript server is already running');
    }

    this.projectPath = projectPath;
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
    // Consider project loaded after starting - tsserver can handle requests while indexing
    this.projectLoaded = true;
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
    // After opening a file successfully, consider the project loaded
    this.projectLoaded = true;
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
      filesChanged: [],
      changes: []
    };
  }
}


