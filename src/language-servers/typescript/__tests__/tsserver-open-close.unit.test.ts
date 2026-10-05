/**
 * Tests for open and close against a tsserver that never answers them.
 *
 * tsserver before 5.6 writes no response to `open` or `close`, and the server
 * prefers the project's own TypeScript, so in a project pinned to 5.4 every
 * operation awaited a reply that never came and failed after 30 seconds with
 * `Request open timed out`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../tsserver-client.js';

/** Answers every request as tsserver does, but stays silent on open and close as 5.5 and earlier do */
const FAKE_TSSERVER = `
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  let end;
  while ((end = buffered.indexOf('\\n')) !== -1) {
    const request = JSON.parse(buffered.slice(0, end));
    buffered = buffered.slice(end + 1);
    if (request.command === 'open' || request.command === 'close') continue;
    const response = JSON.stringify({
      seq: 0,
      type: 'response',
      command: request.command,
      request_seq: request.seq,
      success: true,
    });
    process.stdout.write(
      'Content-Length: ' + Buffer.byteLength(response) + '\\r\\n\\r\\n' + response,
    );
  }
});
`;

let dir: string;
let fakeTsserverPath: string;
let sourcePath: string;
let server: TypeScriptServer | null = null;

describe('open and close against tsserver before 5.6', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-refactor-fake-tsserver-'));
    fakeTsserverPath = join(dir, 'tsserver.js');
    sourcePath = join(dir, 'index.ts');
    await writeFile(fakeTsserverPath, FAKE_TSSERVER, 'utf-8');
    await writeFile(sourcePath, 'export const value = 1;\n', 'utf-8');
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  it('should not wait for a reply to open', async () => {
    // Arrange
    server = new TypeScriptServer(() => fakeTsserverPath);
    await server.start(dir);
    const startedAt = Date.now();

    // Act
    await server.openFile(sourcePath);

    // Assert
    expect(Date.now() - startedAt).toBeLessThan(1000);
  }, 5000);

  it('should not wait for a reply to close', async () => {
    // Arrange
    server = new TypeScriptServer(() => fakeTsserverPath);
    await server.start(dir);
    const startedAt = Date.now();

    // Act
    await server.closeFile(sourcePath);

    // Assert
    expect(Date.now() - startedAt).toBeLessThan(1000);
  }, 5000);
});
