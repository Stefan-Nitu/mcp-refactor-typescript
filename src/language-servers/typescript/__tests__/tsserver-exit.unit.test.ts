/**
 * Tests for requests made once tsserver is gone.
 *
 * sendRequest wrote to the stdin of the last process it started without
 * checking that it was still alive, so after tsserver exited - killed, out of
 * memory, crashed - every request sat out its full 30-second timeout. File
 * discovery retries a request up to 30 times, so a crash during discovery
 * could stall a single tool call for about 15 minutes.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { TSServerGuard } from '../../../operations/shared/tsserver-guard.js';
import { TypeScriptServer } from '../tsserver-client.js';

async function killTsserver(server: TypeScriptServer): Promise<void> {
  const child = server['process']!;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

describe('TypeScriptServer once tsserver is gone', () => {
  let server: TypeScriptServer | null = null;

  afterEach(async () => {
    if (server?.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  it('should reject a request at once after tsserver was killed', async () => {
    // Arrange
    server = new TypeScriptServer();
    await server.start(process.cwd());
    await killTsserver(server);
    const startedAt = Date.now();

    // Act
    const request = server.sendRequest('projectInfo', {
      file: import.meta.path,
      needFileNameList: false,
    });

    // Assert
    await expect(request).rejects.toThrow('tsserver is not running');
    expect(Date.now() - startedAt).toBeLessThan(1000);
  }, 10000);

  it('should reject a request at once when tsserver was never started', async () => {
    // Arrange
    server = new TypeScriptServer();
    const startedAt = Date.now();

    // Act
    const request = server.sendRequest('projectInfo', {
      file: import.meta.path,
      needFileNameList: false,
    });

    // Assert
    await expect(request).rejects.toThrow('tsserver is not running');
    expect(Date.now() - startedAt).toBeLessThan(1000);
  }, 10000);

  it('should restart a killed tsserver for the next operation', async () => {
    // Arrange
    server = new TypeScriptServer();
    await server.start(process.cwd());
    await killTsserver(server);

    // Act
    const notReady = await new TSServerGuard(server).ensureReady(10000);
    await server.openFile(import.meta.path);
    const info = await server.sendRequest<{ configFileName?: string }>(
      'projectInfo',
      { file: import.meta.path, needFileNameList: false },
    );

    // Assert
    expect(notReady).toBeNull();
    expect(info?.configFileName).toContain('tsconfig.json');
  }, 20000);
});
