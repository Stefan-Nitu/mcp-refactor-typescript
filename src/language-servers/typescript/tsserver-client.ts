/**
 * Direct TSServer client implementation
 * Communicates with tsserver using its native protocol for full project awareness
 */

import { ChildProcess, spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
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
  private running = false;

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

    return new Promise<void>((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.once('exit', () => {
        this.process = null;
        this.running = false;
        logger.debug('TSServer process exited');
        resolve();
      });

      this.process.kill('SIGTERM');

      // Force kill after 2 seconds if graceful shutdown fails
      setTimeout(() => {
        if (this.process) {
          logger.warn('TSServer did not exit gracefully, force killing');
          this.process.kill('SIGKILL');
        }
      }, 2000);
    });
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
      } else if (message.event === 'projectLoadingStart') {
        logger.debug('Project loading started');
      } else if (message.event === 'projectsUpdatedInBackground') {
        logger.debug('Projects updated in background');
        this.projectLoaded = true;
      }
    }

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

  async reloadFile(filePath: string): Promise<void> {
    await this.sendRequest('close', { file: filePath });
    await this.openFile(filePath);
    logger.debug({ filePath }, 'Reloaded file in tsserver');
  }

  isProjectLoaded(): boolean {
    return this.projectLoaded;
  }

}