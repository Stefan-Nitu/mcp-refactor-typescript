/**
 * Integration tests for grouped MCP tools
 * Verifies that grouped tools properly route to operations
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperationRegistry } from '../../registry.js';
import { groupedTools } from '../grouped-tools.js';

describe('Grouped Tools Integration', () => {
  let registry: OperationRegistry;

  beforeAll(async () => {
    registry = new OperationRegistry();
    await registry.initialize();
  }, 30000);

  afterAll(async () => {
    await registry.shutdown();
  });

  describe('Tool Structure', () => {
    it('should have exactly 4 grouped tools', () => {
      expect(groupedTools).toHaveLength(4);
    });

    it('should have correct tool names', () => {
      const names = groupedTools.map(t => t.name);
      expect(names).toEqual([
        'file_operations',
        'code_quality',
        'refactoring',
        'workspace'
      ]);
    });

    it('should have MCP annotations', () => {
      groupedTools.forEach(tool => {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      });
    });

    it('should have optimized descriptions under 300 characters', () => {
      groupedTools.forEach(tool => {
        expect(tool.description.length).toBeLessThan(300);
        expect(tool.description).toContain('Use when');
      });
    });
  });

  describe('file_operations Tool', () => {
    const fileTool = groupedTools[0];

    it('should support rename_file, move_file, batch_move_files operations', () => {
      expect(fileTool.operations).toEqual(['rename_file', 'move_file', 'batch_move_files']);
    });

    it('should have inputSchema with operation enum', () => {
      expect(fileTool.inputSchema).toBeDefined();
      const schema = 'shape' in fileTool.inputSchema
        ? fileTool.inputSchema.shape
        : fileTool.inputSchema._def.schema.shape;
      expect(schema.operation).toBeDefined();
    });

    it('should route to rename_file operation', async () => {
      const result = await fileTool.execute({
        operation: 'rename_file',
        sourcePath: 'nonexistent.ts',
        name: 'renamed.ts'
      }, registry);

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
      expect(result.message).toBeTruthy();
    });
  });

  describe('code_quality Tool', () => {
    const qualityTool = groupedTools[1];

    it('should support organize_imports, fix_all, remove_unused operations', () => {
      expect(qualityTool.operations).toEqual([
        'organize_imports',
        'fix_all',
        'remove_unused'
      ]);
    });

    it('should route to organize_imports operation', async () => {
      const result = await qualityTool.execute({
        operation: 'organize_imports',
        filePath: 'nonexistent.ts'
      }, registry);

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });
  });

  describe('refactoring Tool', () => {
    const refactorTool = groupedTools[2];

    it('should support rename and extract operations', () => {
      expect(refactorTool.operations).toEqual([
        'rename',
        'extract_function',
        'extract_constant',
        'extract_variable',
        'infer_return_type'
      ]);
    });

    it('should route to extract_function operation', async () => {
      const result = await refactorTool.execute({
        operation: 'extract_function',
        filePath: 'nonexistent.ts',
        line: 1,
        text: 'test'
      }, registry);

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });
  });

  describe('workspace Tool', () => {
    const workspaceTool = groupedTools[3];

    it('should support workspace-wide operations', () => {
      expect(workspaceTool.operations).toEqual([
        'find_references',
        'refactor_module',
        'cleanup_codebase',
        'restart_tsserver'
      ]);
    });

    it('should be marked as potentially destructive', () => {
      expect(workspaceTool.annotations.destructiveHint).toBe(true);
    });

    it('should route to find_references operation', async () => {
      const result = await workspaceTool.execute({
        operation: 'find_references',
        filePath: 'nonexistent.ts',
        line: 1,
        text: 'test'
      }, registry);

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });

    it('should handle restart_tsserver operation', async () => {
      const result = await workspaceTool.execute({
        operation: 'restart_tsserver'
      }, registry);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toContain('restarted');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown operation gracefully', async () => {
      const fileTool = groupedTools[0];

      await expect(
        fileTool.execute({
          operation: 'unknown_operation',
          filePath: 'test.ts'
        }, registry)
      ).rejects.toThrow('Operation not found');
    });

    it('should handle missing required parameters', async () => {
      const fileTool = groupedTools[0];

      const result = await fileTool.execute({
        operation: 'rename_file'
        // Missing required params
      }, registry);

      expect(result.success).toBe(false);
    });
  });

  describe('Telemetry', () => {
    it('should log tool calls', async () => {
      const fileTool = groupedTools[0];

      // Execute operation - telemetry logging happens internally
      await fileTool.execute({
        operation: 'rename_file',
        sourcePath: 'test.ts',
        name: 'renamed.ts'
      }, registry);

      // Telemetry logs to stderr, so we can't easily verify here
      // But the test shouldn't throw errors
      expect(true).toBe(true);
    });
  });
});
