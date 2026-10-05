/**
 * Tests for keeping the files tsserver has open in step with the disk.
 *
 * tsserver takes an open file's content from the client and stops reading it
 * from disk, and nothing ever sent a file again once it was open, so a write
 * made afterwards was invisible and later edits were computed from stale
 * text. The sync runs before every operation and every step of a composite
 * one, so a file that has not changed must cost no more than a stat.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../tsserver-client.js';

/** Collects the command of every message written to the current tsserver from now on */
function recordCommands(server: TypeScriptServer): string[] {
  const commands: string[] = [];
  const stdin = server['process']!.stdin!;
  const write = stdin.write.bind(stdin);
  stdin.write = ((message: string) => {
    commands.push(JSON.parse(message).command);
    return write(message);
  }) as typeof stdin.write;
  return commands;
}

let dir: string;
let filePath: string;
let server: TypeScriptServer | null = null;

describe('TypeScriptServer.syncOpenFiles', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-refactor-open-files-'));
    filePath = join(dir, 'index.ts');
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  it('should not send a file again while it is unchanged on disk', async () => {
    // Arrange
    await writeFile(filePath, 'export const value = 1;\n', 'utf-8');
    server = new TypeScriptServer();
    await server.start(dir);
    await server.openFile(filePath);
    const sent = recordCommands(server);

    // Act
    await server.syncOpenFiles();

    // Assert
    expect(sent).toEqual([]);
  });

  it('should send a file again once it has changed on disk', async () => {
    // Arrange
    await writeFile(filePath, 'export const value = 1;\n', 'utf-8');
    server = new TypeScriptServer();
    await server.start(dir);
    await server.openFile(filePath);
    await writeFile(filePath, 'export const value = 12;\n', 'utf-8');
    const sent = recordCommands(server);

    // Act
    await server.syncOpenFiles();

    // Assert
    expect(sent).toEqual(['open']);
  });

  it('should forget the files a previous tsserver process had open', async () => {
    // Arrange - a restarted tsserver has nothing open, so there is nothing of
    // the old process's to bring up to date
    await writeFile(filePath, 'export const value = 1;\n', 'utf-8');
    server = new TypeScriptServer();
    await server.start(dir);
    await server.openFile(filePath);
    await server.stop();
    await server.start(dir);
    await writeFile(filePath, 'export const value = 12;\n', 'utf-8');
    const sent = recordCommands(server);

    // Act
    await server.syncOpenFiles();

    // Assert
    expect(sent).toEqual([]);
  });
});
