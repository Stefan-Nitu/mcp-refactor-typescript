/**
 * Direct TSServer client implementation
 * Communicates with tsserver using its native protocol for full project awareness
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
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
  message?: string;
  body?: unknown;
  event?: string;
}

/** A file on disk as it was when its content was last sent to tsserver */
interface SentFile {
  mtimeMs: number;
  size: number;
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
  // tsserver takes an open file's content from the client and stops reading
  // it from disk, so every later write has to be sent again - see syncOpenFiles
  private openFiles = new Map<string, SentFile>();

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

    // All belong to the process being replaced: a carried-over flag makes the
    // readiness guard skip its wait, a half-read frame from the dead server
    // would consume the start of the new one's output, and the new one has no
    // files open
    this.projectLoaded = false;
    this.parser = new MessageParser();
    this.openFiles.clear();

    // Not a bare `node`: desktop MCP clients launch this server by an absolute
    // path with a minimal PATH, where there may be no `node` to find
    const child = spawn(process.execPath, [tsserverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectPath,
      env: {
        ...process.env,
      },
    });
    this.process = child;

    // Left undecoded: the parser needs byte offsets to honour Content-Length
    this.process.stdout?.on('data', (data) => this.handleData(data));

    // A write that reaches tsserver after it died but before Node has seen it
    // exit fails with EPIPE, and Node throws that from stdin when nothing is
    // listening - taking this whole server down. The exit that follows fails
    // the request instead
    this.process.stdin?.on('error', (error) => {
      logger.debug({ error }, 'TSServer stdin error');
    });

    let stderrOutput = '';
    this.process.stderr?.setEncoding('utf8');
    this.process.stderr?.on('data', (data) => {
      stderrOutput += data.toString();
      logger.debug({ stderr: data.toString() }, 'TSServer stderr');
    });

    // A tsserver that dies never answers, so fail its callers now instead of
    // leaving them to wait out the 30s request timeout
    this.process.on('error', (error) => {
      this.processGone(
        child,
        new Error(
          `Could not spawn tsserver at ${tsserverPath}: ${error.message}`,
        ),
      );
    });

    this.process.on('exit', (code) => {
      logger.info({ code }, 'TSServer process exited');
      const cause = summarizeStderr(stderrOutput);
      this.processGone(
        child,
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

  private processGone(child: ChildProcess, reason: Error): void {
    // A process a restart has already replaced must not take down its successor
    if (this.process !== child) return;
    // Cleared because this is what send() checks - `running` cannot stand in,
    // as start() sets it only once its own configure request is answered
    this.process = null;
    this.running = false;
    this.failPendingRequests(reason);
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
          // tsserver gives a failure's reason in the response's own `message`
          // and sends no body with it. The reason is the first line; the rest
          // is tsserver's stack trace, which would reach the model as part of
          // the operation's error
          logger.debug(
            { command: message.command, message: message.message },
            'TSServer request failed',
          );
          const errorMsg =
            message.message?.split('\n')[0] ||
            `tsserver could not complete ${message.command ?? 'a request'}`;
          pending.reject(new Error(errorMsg));
        }
      }
    }
  }

  async sendRequest<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T | null> {
    const seq = this.send(command, args);

    return new Promise<T | null>((resolve, reject) => {
      // Nothing cleared this once the reply arrived, so every request left a
      // timer alive for its full 30 seconds - a cleanup sweep over a large
      // project accumulates one per request. Unref'd so a request still in
      // flight cannot hold the process open either; the transport's stdin is
      // what keeps the server alive
      const timeout = setTimeout(() => {
        if (this.pendingRequests.delete(seq)) {
          reject(new Error(`Request ${command} timed out`));
        }
      }, 30000);
      timeout.unref();

      this.pendingRequests.set(seq, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          resolve(value as T | null);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  /** Writes a request to tsserver and returns its seq, without waiting for a reply */
  private send(command: string, args?: Record<string, unknown>): number {
    // Nothing answers a request written to a tsserver that has exited, so each
    // one sat out its full 30s timeout - and file discovery retries 30 times
    if (!this.process?.stdin) {
      throw new Error(`Cannot send ${command}: tsserver is not running`);
    }

    const seq = ++this.seq;
    const request: TSServerRequest = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };
    this.process.stdin.write(`${JSON.stringify(request)}\n`);
    return seq;
  }

  // Open and close are sent without awaiting a reply: tsserver before 5.6
  // never answers either, so every operation in a project pinned to an older
  // TypeScript failed on the 30s timeout. tsserver handles messages in order,
  // so later requests still see the file, and the reply 5.6+ does send
  // matches no pending request and is dropped
  async openFile(filePath: string): Promise<void> {
    // Taken before the read, so a write landing between the two leaves the
    // recorded mtime behind the file and the next sync sends it again
    const { mtimeMs, size } = await stat(filePath);
    const content = await readFile(filePath, 'utf8');
    this.send('open', { file: filePath, fileContent: content });
    this.openFiles.set(filePath, { mtimeMs, size });
  }

  /**
   * Gives tsserver content the disk does not hold - an edit computed but not
   * yet written, or a preview's, never to be. Recorded as matching no file,
   * because the stat check cannot notice content that was never written:
   * the next syncOpenFiles sends the disk content back.
   */
  async openFileWithContent(filePath: string, content: string): Promise<void> {
    this.send('open', { file: filePath, fileContent: content });
    this.openFiles.set(filePath, { mtimeMs: Number.NaN, size: -1 });
  }

  async closeFile(filePath: string): Promise<void> {
    this.send('close', { file: filePath });
    this.openFiles.delete(filePath);
  }

  /**
   * Sends tsserver the disk content of every open file that changed since it
   * was sent, and closes those that no longer exist. Without this, an edit by
   * an editor, a checkout or this server's previous operation stayed
   * invisible, and edits computed from the old text landed on the new one.
   * An unchanged file costs one stat.
   */
  async syncOpenFiles(): Promise<void> {
    await Promise.all(
      Array.from(this.openFiles, async ([filePath, sent]) => {
        const onDisk = await stat(filePath).catch(() => null);
        if (!onDisk) {
          await this.closeFile(filePath);
        } else if (
          onDisk.mtimeMs !== sent.mtimeMs ||
          onDisk.size !== sent.size
        ) {
          // One deleted between the stat above and the read is closed instead,
          // leaving tsserver to read the disk for itself
          await this.openFile(filePath).catch(() => this.closeFile(filePath));
        }
      }),
    );
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
