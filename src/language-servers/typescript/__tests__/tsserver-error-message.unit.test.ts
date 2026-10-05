/**
 * Tests for the error a failed tsserver request rejects with.
 *
 * tsserver gives a failure's reason in the response's own `message` and sends
 * no body with it, but the client read the reason from the body and fell back
 * to `String(body)` - so every tsserver error reached the user as the text
 * "undefined", such as an extract or a rename on a file tsserver can't find.
 * The reason is followed by tsserver's own stack trace, which has no place in
 * an error a model reads.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../tsserver-client.js';

/** Answers configure, and fails every other request without giving a reason */
const FAKE_TSSERVER = `
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  let end;
  while ((end = buffered.indexOf('\\n')) !== -1) {
    const request = JSON.parse(buffered.slice(0, end));
    buffered = buffered.slice(end + 1);
    const response = JSON.stringify({
      seq: 0,
      type: 'response',
      command: request.command,
      request_seq: request.seq,
      success: request.command === 'configure',
    });
    process.stdout.write(
      'Content-Length: ' + Buffer.byteLength(response) + '\\r\\n\\r\\n' + response,
    );
  }
});
`;

const missingFile = join(import.meta.dir, 'missing.ts');

let dir: string;
let fakeTsserverPath: string;
let server: TypeScriptServer | null = null;

describe('a failed tsserver request', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-refactor-fake-tsserver-'));
    fakeTsserverPath = join(dir, 'tsserver.js');
    await writeFile(fakeTsserverPath, FAKE_TSSERVER, 'utf-8');
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  it('should reject with the reason tsserver gives, without its stack trace', async () => {
    // Arrange
    server = new TypeScriptServer();
    await server.start(process.cwd());

    // Act
    const error = await server
      .sendRequest('getApplicableRefactors', {
        file: missingFile,
        startLine: 1,
        startOffset: 1,
        endLine: 1,
        endOffset: 1,
      })
      .catch((rejection: Error) => rejection);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Error processing request. No Project.',
    );
    expect((error as Error).message).not.toMatch(/\n\s+at /);
  }, 10000);

  it('should name the request when tsserver gives no reason', async () => {
    // Arrange
    server = new TypeScriptServer(() => fakeTsserverPath);
    await server.start(dir);

    // Act
    const error = await server
      .sendRequest('rename', { file: missingFile, line: 1, offset: 1 })
      .catch((rejection: Error) => rejection);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('rename');
    expect((error as Error).message).not.toContain('undefined');
  }, 5000);
});
