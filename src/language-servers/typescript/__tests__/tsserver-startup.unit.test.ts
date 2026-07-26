/**
 * Tests for how TypeScriptServer reports a tsserver that never comes up.
 *
 * Before this, a tsserver that died on spawn left the `configure` request with
 * nobody to answer it, so callers waited the full 30s request timeout and were
 * told the file was at fault.
 */

import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../tsserver-client.js';

describe('TypeScriptServer startup failure', () => {
  it('should reject with the tsserver path when the process cannot start', async () => {
    // Arrange
    const missingTsserver = join(tmpdir(), 'nonexistent-tsserver.js');
    const server = new TypeScriptServer(() => missingTsserver);

    // Act & Assert
    await expect(server.start(process.cwd())).rejects.toThrow(missingTsserver);
  });

  it('should fail fast rather than waiting for the request timeout', async () => {
    // Arrange
    const server = new TypeScriptServer(() =>
      join(tmpdir(), 'nonexistent-tsserver.js'),
    );
    const startedAt = Date.now();

    // Act
    await server.start(process.cwd()).catch(() => {});

    // Assert
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('should not report itself as running after a failed start', async () => {
    // Arrange
    const server = new TypeScriptServer(() =>
      join(tmpdir(), 'nonexistent-tsserver.js'),
    );

    // Act
    await server.start(process.cwd()).catch(() => {});

    // Assert
    expect(server.isRunning()).toBe(false);
  });
});
