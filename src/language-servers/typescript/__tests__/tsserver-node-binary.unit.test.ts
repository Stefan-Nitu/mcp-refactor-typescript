/**
 * Tests for which Node binary runs tsserver.
 *
 * tsserver was spawned as a bare `node`, looked up on PATH. Desktop MCP
 * clients usually launch the server by an absolute Node path with a minimal
 * PATH, and there every operation failed with `spawn node ENOENT`.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../tsserver-client.js';

describe('TypeScriptServer without node on PATH', () => {
  let server: TypeScriptServer | null = null;
  let emptyDir: string | null = null;

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
    if (emptyDir) {
      await rm(emptyDir, { recursive: true, force: true });
      emptyDir = null;
    }
  });

  it('should start tsserver with the Node that runs this server', async () => {
    // Arrange
    emptyDir = await mkdtemp(join(tmpdir(), 'mcp-refactor-no-node-'));
    const originalPath = process.env.PATH;
    process.env.PATH = emptyDir;
    server = new TypeScriptServer();

    // Act
    try {
      await server.start(process.cwd());
    } finally {
      process.env.PATH = originalPath;
    }

    // Assert
    expect(server.isRunning()).toBe(true);
  });
});
