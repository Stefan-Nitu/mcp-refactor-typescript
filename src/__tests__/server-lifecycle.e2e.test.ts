/**
 * E2E tests for MCP server lifecycle: initialization, startup, and cleanup
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperationRegistry } from '../operations/registry.js';

describe('MCP Server Lifecycle E2E', () => {
  let registry: OperationRegistry;

  beforeAll(async () => {
    // Arrange: We're in the actual project root which has TypeScript files

    // Act: Initialize registry (simulates MCP server startup)
    registry = new OperationRegistry();
    await registry.initialize();
  }, 30000);

  afterAll(async () => {
    await registry.shutdown();
  });

  it('should start tsserver and begin indexing project files immediately', async () => {
    // Assert: tsserver should be running because project has TypeScript files
    expect(registry['tsServer'].isRunning()).toBe(true);
  }, 30000);

  it('should detect TypeScript files in the current project', async () => {
    // Assert: Registry should have detected TS files and started tsserver
    const hasTypeScriptFiles = await registry['hasTypeScriptFiles']();
    expect(hasTypeScriptFiles).toBe(true);
  });

  it('should have all operations registered', () => {
    // Assert
    const operations = registry.getOperationNames();

    expect(operations).toContain('rename');
    expect(operations).toContain('move_file');
    expect(operations).toContain('organize_imports');
    expect(operations).toContain('find_references');
    expect(operations).toContain('cleanup_codebase');
    expect(operations).toContain('restart_tsserver');
  });

  it('should cleanup tsserver and exit when stdin closes', async () => {
    // Arrange
    const { spawn } = await import('child_process');
    const { resolve } = await import('path');
    const serverPath = resolve(__dirname, '../../dist/index.js');

    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const serverPid = server.pid!;

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get child process PIDs
    const { exec } = await import('child_process');
    const { stdout: psOutput } = await new Promise<{stdout: string}>((resolve) => {
      exec(`ps -o pid,ppid,comm | grep ${serverPid}`, (_error, stdout) => {
        resolve({ stdout });
      });
    });

    const childPids = psOutput.split('\n')
      .filter(line => line.includes('tsserver') || line.includes('typingsInstaller'))
      .map(line => parseInt(line.trim().split(/\s+/)[0]))
      .filter(pid => !isNaN(pid));

    // Act - Close stdin to simulate client disconnect
    server.stdin?.end();

    // Assert - Server should exit within 5 seconds (not become a zombie)
    const exitPromise = new Promise<number>((resolve) => {
      server.on('exit', (code) => resolve(code ?? 0));
    });

    const timeout = new Promise<number>((_, reject) => {
      setTimeout(() => reject(new Error('Server did not exit within 5 seconds - zombie process detected!')), 5000);
    });

    const exitCode = await Promise.race([exitPromise, timeout]);
    expect(exitCode).toBe(0);

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Assert - Child tsserver processes should also be cleaned up
    for (const childPid of childPids) {
      const { stdout } = await new Promise<{stdout: string}>((resolve) => {
        exec(`ps -p ${childPid}`, (_error, stdout) => {
          resolve({ stdout });
        });
      });

      // Process should not exist anymore
      expect(stdout).not.toContain('tsserver');
      expect(stdout).not.toContain('typingsInstaller');
    }
  }, 15000);
});
