/**
 * E2E tests for MCP server initialization and tsserver startup
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperationRegistry } from '../operations/registry.js';

describe('MCP Server Startup E2E', () => {
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
});
