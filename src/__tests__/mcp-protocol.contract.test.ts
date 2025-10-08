/**
 * MCP Protocol Contract Tests
 *
 * Verifies that the server follows MCP protocol requirements:
 * - Only writes JSON-RPC messages to stdout
 * - Writes all logs to stderr (never stdout)
 * - Responds correctly to JSON-RPC requests
 * - Handles stdin close gracefully
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MCP Protocol Contract', () => {
  let server: ChildProcess | null = null;
  let stdoutData: string[] = [];
  let stderrData: string[] = [];

  beforeEach(() => {
    stdoutData = [];
    stderrData = [];
  });

  afterEach(() => {
    if (server && !server.killed) {
      server.kill('SIGTERM');
      server = null;
    }
  });

  it('should only write JSON-RPC messages to stdout, never logs', async () => {
    // Arrange
    const serverPath = resolve(__dirname, '../../dist/index.js');
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    server.stdout?.on('data', (data) => {
      stdoutData.push(data.toString());
    });

    server.stderr?.on('data', (data) => {
      stderrData.push(data.toString());
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Act - Send initialize request (valid JSON-RPC)
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    };

    server.stdin?.write(JSON.stringify(initializeRequest) + '\n');

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Assert - stdout should ONLY contain valid JSON-RPC
    const allStdout = stdoutData.join('');
    const stdoutLines = allStdout.trim().split('\n').filter(line => line.trim());

    for (const line of stdoutLines) {
      // Each line must be valid JSON
      expect(() => JSON.parse(line)).not.toThrow();

      const parsed = JSON.parse(line);

      // Must be valid JSON-RPC 2.0
      expect(parsed.jsonrpc).toBe('2.0');

      // Must have either id (response) or method (notification)
      expect(parsed.id !== undefined || parsed.method !== undefined).toBe(true);
    }

    // Assert - stdout must NOT contain log messages
    expect(allStdout).not.toMatch(/Server started/i);
    expect(allStdout).not.toMatch(/Project loaded/i);
    expect(allStdout).not.toMatch(/TSServer/i);
    expect(allStdout).not.toMatch(/Initializing/i);
  }, 10000);

  it('should write all log messages to stderr, never stdout', async () => {
    // Arrange
    const serverPath = resolve(__dirname, '../../dist/index.js');
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    server.stdout?.on('data', (data) => {
      stdoutData.push(data.toString());
    });

    server.stderr?.on('data', (data) => {
      stderrData.push(data.toString());
    });

    // Wait for server to start and log messages
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Assert - stderr should contain log messages
    const allStderr = stderrData.join('');

    // Pino logs in JSON format to stderr
    expect(allStderr.length).toBeGreaterThan(0);

    // Should contain structured log entries (Pino format)
    const hasJsonLogs = allStderr.split('\n').some(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.level !== undefined && parsed.time !== undefined;
      } catch {
        return false;
      }
    });

    expect(hasJsonLogs).toBe(true);

    // Assert - stdout should NOT contain any log-like content
    const allStdout = stdoutData.join('');

    // These patterns indicate logs leaked to stdout
    expect(allStdout).not.toMatch(/\[INFO\]/);
    expect(allStdout).not.toMatch(/\[DEBUG\]/);
    expect(allStdout).not.toMatch(/\[ERROR\]/);
    expect(allStdout).not.toMatch(/console\./);
  }, 10000);

  it('should respond to initialize request with valid JSON-RPC', async () => {
    // Arrange
    const serverPath = resolve(__dirname, '../../dist/index.js');
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    interface InitializeResult {
      protocolVersion: string;
      capabilities: unknown;
      serverInfo: { name: string; version: string };
    }

    const responses: Array<{ jsonrpc: string; id?: number; result?: InitializeResult; method?: string }> = [];

    server.stdout?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            responses.push(JSON.parse(line));
          } catch {
            // Ignore parse errors for this test
          }
        }
      }
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Act - Send initialize request
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    };

    server.stdin?.write(JSON.stringify(initializeRequest) + '\n');

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Assert - Should have received valid initialize response
    const initResponse = responses.find(r => r.id === 1);

    expect(initResponse).toBeDefined();
    expect(initResponse!.jsonrpc).toBe('2.0');
    expect(initResponse!.id).toBe(1);
    expect(initResponse!.result).toBeDefined();
    expect(initResponse!.result?.protocolVersion).toBeDefined();
    expect(initResponse!.result?.capabilities).toBeDefined();
    expect(initResponse!.result?.serverInfo).toBeDefined();
    expect(initResponse!.result?.serverInfo.name).toBe('mcp-refactor-typescript');
  }, 10000);

  it('should handle stdin close and exit gracefully within 5 seconds', async () => {
    // Arrange
    const serverPath = resolve(__dirname, '../../dist/index.js');
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Act - Close stdin to simulate client disconnect
    server.stdin?.end();

    // Assert - Server should exit within 5 seconds
    const exitPromise = new Promise<number>((resolve) => {
      server!.on('exit', (code) => resolve(code ?? 0));
    });

    const timeout = new Promise<number>((_, reject) => {
      setTimeout(() => reject(new Error('Server did not exit within 5 seconds - zombie process detected!')), 5000);
    });

    const exitCode = await Promise.race([exitPromise, timeout]);
    expect(exitCode).toBe(0);
  }, 10000);

  it('should not write to stdout before receiving any requests', async () => {
    // Arrange
    const serverPath = resolve(__dirname, '../../dist/index.js');
    server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutReceived = false;

    server.stdout?.on('data', () => {
      stdoutReceived = true;
    });

    // Act - Wait without sending any requests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Assert - stdout should be completely empty (no unsolicited output)
    expect(stdoutReceived).toBe(false);
  }, 10000);
});
