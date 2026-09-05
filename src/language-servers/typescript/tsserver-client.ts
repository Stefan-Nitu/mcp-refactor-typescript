/**
 * Direct TSServer client implementation
 * Communicates with tsserver using its native protocol for full project awareness
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { logger } from '../../utils/logger.js';
import { MessageParser } from './message-parser.js';
import { resolveTsserverPath } from './resolve-tsserver-path.js';

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

/** A crashing tsserver prints a full stack trace; the Error line carries the cause */
function summarizeStderr(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /Error(:|\s)/.test(line)) ?? lines[0] ?? '';
}

export class TypeScriptServer {
  private process: ChildProcess | null = null;
  private seq = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private parser = new MessageParser();
  private projectLoaded = false;
  private running = false;
  private assumeLoaded: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly resolveTsserver: (
      projectPath: string,
    ) => string = resolveTsserverPath,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(projectPath: string): Promise<void> {
    if (this.running) {
      throw new Error('TypeScript server is already running');
    }

    const tsserverPath = this.resolveTsserver(projectPath);

    // Both belong to the process being replaced: a carried-over flag makes the
    // readiness guard skip its wait, and a half-read frame from the dead server
    // would consume the start of the new one's output
    this.projectLoaded = false;
    this.parser = new MessageParser();

    const child = spawn('node', [tsserverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectPath,
      env: {
        ...process.env,
      },
    });
    this.process = child;

    // Left undecoded: the parser needs byte offsets to honour Content-Length
    this.process.stdout?.on('data', (data) => this.handleData(data));

    let stderrOutput = '';
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (data) => {
      stderrOutput += data.toString();
      logger.debug({ stderr: data.toString() }, 'TSServer stderr');
    });

    // A tsserver that dies never answers, so fail its callers now instead of
    // leaving them to wait out the 30s request timeout
    this.process.on('error', (error) => {
      this.running = false;
      this.failPendingRequests(
        new Error(
          `Could not spawn tsserver at ${tsserverPath}: ${error.message}`,
        ),
      );
    });

    this.process.on('exit', (code) => {
      logger.info({ code }, 'TSServer process exited');
      this.running = false;
      const cause = summarizeStderr(stderrOutput);
      this.failPendingRequests(
        new Error(
          `tsserver at ${tsserverPath} exited with code ${code}${
            cause ? `: ${cause}` : ''
          }`,
        ),
      );
    });

    // Configure preferences
    await this.sendRequest('configure', {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
        allowIncompleteCompletions: true,
        includeAutomaticOptionalChainCompletions: true,
        allowTextChangesInNewFiles: true,
      },
    });

    this.running = true;

    // For small/empty projects, projectLoadingStart might not fire
    // If we don't see it within 500ms, assume project is ready.
    // Gated on `child` rather than `running`, which a restart sets back to true
    this.assumeLoaded = setTimeout(() => {
      if (!this.projectLoaded && this.process === child) {
        logger.debug(
          'No project loading event received, assuming small project',
        );
        this.projectLoaded = true;
      }
    }, 500);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.process) {
      return;
    }

    // Captured so neither the timer nor the exit handler can act on a later
    // process - a restart replaces this.process well within the 2s window
    const child = this.process;

    if (this.assumeLoaded) {
      clearTimeout(this.assumeLoaded);
      this.assumeLoaded = null;
    }

    return new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        logger.warn('TSServer did not exit gracefully, force killing');
        child.kill('SIGKILL');
      }, 2000);

      child.once('exit', () => {
        clearTimeout(forceKill);
        if (this.process === child) {
          this.process = null;
          this.running = false;
        }
        logger.debug('TSServer process exited');
        resolve();
      });

      child.kill('SIGTERM');
    });
  }

  private failPendingRequests(reason: Error): void {
    for (const [seq, pending] of this.pendingRequests) {
      this.pendingRequests.delete(seq);
      pending.reject(reason);
    }
  }

  private handleData(data: Buffer): void {
    for (const message of this.parser.feed(data)) {
      this.handleMessage(message as TSServerResponse);
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
          const errorMsg =
            (message.body as { message?: string })?.message ||
            String(message.body) ||
            'Request failed';
          pending.reject(new Error(errorMsg));
        }
      }
    }
  }

  async sendRequest<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const seq = ++this.seq;
      const request: TSServerRequest = {
        seq,
        type: 'request',
        command,
        arguments: args,
      };

      this.pendingRequests.set(seq, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const message = `${JSON.stringify(request)}\n`;
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
      fileContent: content,
    });
  }

  async closeFile(filePath: string): Promise<void> {
    await this.sendRequest('close', { file: filePath });
  }

  async reloadFile(filePath: string): Promise<void> {
    await this.closeFile(filePath);
    await this.openFile(filePath);
    logger.debug({ filePath }, 'Reloaded file in tsserver');
  }

  isProjectLoaded(): boolean {
    return this.projectLoaded;
  }
}
