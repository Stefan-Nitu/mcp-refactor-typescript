/**
 * Integration tests for grouped MCP tools
 * Verifies that grouped tools properly route to operations
 */

import type { Mock } from 'bun:test';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { OperationName } from '../../operation-name.js';
import { OperationRegistry } from '../../registry.js';
import { logger } from '../../utils/logger.js';
import { groupedTools } from '../grouped-tools.js';
import { toolInputShape } from '../tool-input-shape.js';

const missingFile = join(__dirname, 'nonexistent.ts');

describe('Grouped Tools Integration', () => {
  let registry: OperationRegistry;

  beforeAll(async () => {
    registry = new OperationRegistry();
    await registry.initialize();
  }, 30000);

  afterAll(async () => {
    await registry.close();
  });

  describe('Tool Structure', () => {
    it('should have exactly 4 grouped tools', () => {
      expect(groupedTools).toHaveLength(4);
    });

    it('should have correct tool names', () => {
      const names = groupedTools.map((t) => t.name);
      expect(names).toEqual([
        'file_operations',
        'code_quality',
        'refactoring',
        'workspace',
      ]);
    });

    it('should have MCP annotations', () => {
      groupedTools.forEach((tool) => {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      });
    });

    it('should have optimized descriptions under 300 characters', () => {
      groupedTools.forEach((tool) => {
        expect(tool.description.length).toBeLessThan(300);
        expect(tool.description).toContain('Use when');
      });
    });
  });

  describe('file_operations Tool', () => {
    const fileTool = groupedTools[0];

    it('should support rename_file, move_file, batch_move_files operations', () => {
      expect(fileTool.operations).toEqual([
        'rename_file',
        'move_file',
        'batch_move_files',
      ]);
    });

    it('should have inputSchema with operation enum', () => {
      expect(fileTool.inputSchema).toBeDefined();
      const schema = toolInputShape(fileTool.inputSchema);
      expect(schema.operation).toBeDefined();
    });

    it('should route to rename_file operation', async () => {
      const result = await fileTool.execute(
        {
          operation: 'rename_file',
          sourcePath: missingFile,
          name: 'renamed.ts',
        },
        registry,
      );

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
        'remove_unused',
      ]);
    });

    it('should route to organize_imports operation', async () => {
      const result = await qualityTool.execute(
        {
          operation: 'organize_imports',
          filePath: missingFile,
        },
        registry,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });
  });

  describe('refactoring Tool', () => {
    const refactorTool = groupedTools[2];

    it('should support rename, extract, and move operations', () => {
      expect(refactorTool.operations).toEqual([
        'rename',
        'extract_function',
        'extract_constant',
        'extract_variable',
        'move_to_file',
        'infer_return_type',
      ]);
    });

    it('should route to extract_function operation', async () => {
      const result = await refactorTool.execute(
        {
          operation: 'extract_function',
          filePath: missingFile,
          line: 1,
          text: 'test',
        },
        registry,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });

    it('should route to move_to_file operation', async () => {
      const result = await refactorTool.execute(
        {
          operation: 'move_to_file',
          filePath: missingFile,
          line: 1,
          text: 'test',
        },
        registry,
      );

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
        'restart_tsserver',
      ]);
    });

    it('should be marked as potentially destructive', () => {
      expect(workspaceTool.annotations.destructiveHint).toBe(true);
    });

    it('should route to find_references operation', async () => {
      const result = await workspaceTool.execute(
        {
          operation: 'find_references',
          filePath: missingFile,
          line: 1,
          text: 'test',
        },
        registry,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false); // File doesn't exist
    });

    it('should handle restart_tsserver operation', async () => {
      const result = await workspaceTool.execute(
        {
          operation: 'restart_tsserver',
        },
        registry,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toContain('restarted');
    });
  });

  describe('Error Handling', () => {
    it('should explain an unknown operation rather than throwing', async () => {
      const fileTool = groupedTools[0];

      const result = await fileTool.execute(
        {
          operation: 'unknown_operation',
          filePath: missingFile,
        },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('operation');
    });

    it('should handle missing required parameters', async () => {
      const fileTool = groupedTools[0];

      const result = await fileTool.execute(
        {
          operation: 'rename_file',
          // Missing required params
        },
        registry,
      );

      expect(result.success).toBe(false);
    });

    it('should name the parameter each operation actually needs', async () => {
      const fileTool = groupedTools[0];

      // rename_file takes `name`; destinationPath belongs to move_file
      const result = await fileTool.execute(
        {
          operation: 'rename_file',
          sourcePath: '/tmp/a.ts',
          destinationPath: '/tmp/b.ts',
        },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('name is required for rename_file');
    });

    it('should name the parameter refactoring actually needs', async () => {
      const refactorTool = groupedTools[2];

      const result = await refactorTool.execute(
        {
          operation: 'rename',
          filePath: '/tmp/a.ts',
          line: 1,
          text: 'old',
        },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('name is required for rename');
    });

    it('should name the parameter find_references actually needs', async () => {
      const workspace = groupedTools[3];

      const result = await workspace.execute(
        { operation: 'find_references', filePath: '/tmp/a.ts', line: 1 },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('text is required for find_references');
    });

    it('should refuse to delete unused files without entrypoints', async () => {
      const workspace = groupedTools[3];

      // cleanup_codebase deletes files; this guard is the only thing standing
      // between a bare call and an unbounded delete
      const result = await workspace.execute(
        {
          operation: 'cleanup_codebase',
          directory: '/tmp',
          deleteUnusedFiles: true,
        },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('entrypoints is required');
    });

    it('should require a filePath for code_quality operations', async () => {
      const codeQuality = groupedTools[1];

      const result = await codeQuality.execute(
        { operation: 'organize_imports' },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('filePath');
    });

    it('should reject cross-field violations before touching the filesystem', async () => {
      const fileTool = groupedTools[0];

      const result = await fileTool.execute(
        { operation: 'move_file', sourcePath: '/tmp/a.ts' },
        registry,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        'destinationPath is required for move_file',
      );
    });
  });

  describe('Relative Paths', () => {
    // An operation resolves a relative path against this process's cwd - the
    // checkout the server was launched in, not necessarily the client's
    it('should reject a relative filePath before the operation runs', async () => {
      // Arrange
      const findReferences = registry.getOperation(
        OperationName.FIND_REFERENCES,
      )!;
      const execute = spyOn(findReferences, 'execute');

      // Act
      const result = await groupedTools[3].execute(
        {
          operation: 'find_references',
          filePath: 'src/nonexistent.ts',
          line: 1,
          text: 'test',
        },
        registry,
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('filePath');
      expect(result.message).toContain('absolute path');
      expect(result.message).toContain(process.cwd());
      expect(execute).not.toHaveBeenCalled();
      execute.mockRestore();
    });

    it('should reject a relative path among files', async () => {
      // Arrange - preview, so a regression here still writes nothing
      const input = {
        operation: 'batch_move_files',
        files: [missingFile, 'src/nonexistent.ts'],
        targetFolder: join(__dirname, 'moved'),
        preview: true,
      };

      // Act
      const result = await groupedTools[0].execute(input, registry);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('files.1');
      expect(result.message).toContain('absolute path');
    });

    it("should reject a relative directory rather than sweep the server's own", async () => {
      // Arrange - `src` exists under this process's cwd; preview, so a
      // regression here still writes nothing
      const input = {
        operation: 'cleanup_codebase',
        directory: 'src',
        preview: true,
      };

      // Act
      const result = await groupedTools[3].execute(input, registry);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('directory');
      expect(result.message).toContain('absolute path');
    });

    it('should pass an absolute path through to the operation', async () => {
      // Arrange
      const findReferences = registry.getOperation(
        OperationName.FIND_REFERENCES,
      )!;
      const execute = spyOn(findReferences, 'execute');

      // Act
      await groupedTools[3].execute(
        {
          operation: 'find_references',
          filePath: missingFile,
          line: 1,
          text: 'test',
        },
        registry,
      );

      // Assert
      expect(execute).toHaveBeenCalled();
      execute.mockRestore();
    });
  });

  describe('Telemetry', () => {
    function recordedEvents(spy: Mock<typeof logger.info>): string[] {
      return spy.mock.calls
        .map(([event]) => (event as { event?: string })?.event)
        .filter((event): event is string => Boolean(event));
    }

    it('should record the call and its outcome', async () => {
      // Arrange
      const info = spyOn(logger, 'info');

      // Act
      await groupedTools[0].execute(
        {
          operation: 'rename_file',
          sourcePath: missingFile,
          name: 'renamed.ts',
        },
        registry,
      );

      // Assert
      expect(recordedEvents(info)).toContain('tool_call');
      info.mockRestore();
    });

    it('should record a rejected call rather than dropping it', async () => {
      // Arrange - validation now returns early, so it has its own log path
      const error = spyOn(logger, 'error');

      // Act
      await groupedTools[0].execute({ operation: 'rename_file' }, registry);

      // Assert
      expect(
        error.mock.calls.map(([event]) => (event as { event?: string })?.event),
      ).toContain('tool_error');
      error.mockRestore();
    });

    // Operations report failure by returning success: false rather than
    // throwing, and runOperation logged every returned result as a success
    it('should record a failure the operation returns as a failure', async () => {
      // Arrange
      const info = spyOn(logger, 'info');
      const error = spyOn(logger, 'error');

      // Act
      const result = await groupedTools[0].execute(
        {
          operation: 'rename_file',
          sourcePath: missingFile,
          name: 'renamed.ts',
        },
        registry,
      );

      // Assert
      const failure = error.mock.calls
        .map(([event]) => event as { event?: string; errorType?: string })
        .find((event) => event?.event === 'tool_error');
      expect(result.success).toBe(false);
      expect(recordedEvents(info)).not.toContain('tool_success');
      expect(failure?.errorType).toBe('OperationFailed');
      info.mockRestore();
      error.mockRestore();
    });

    it('should record a success the operation returns as a success', async () => {
      // Arrange
      const info = spyOn(logger, 'info');

      // Act
      const result = await groupedTools[3].execute(
        { operation: 'restart_tsserver' },
        registry,
      );

      // Assert
      expect(result.success).toBe(true);
      expect(recordedEvents(info)).toContain('tool_success');
      info.mockRestore();
    });
  });

  describe('Concurrent Calls', () => {
    function findReferencesFor(text: string) {
      return groupedTools[3].execute(
        { operation: 'find_references', filePath: missingFile, line: 1, text },
        registry,
      );
    }

    it('should run calls issued together one after the other', async () => {
      // Arrange - the first reports a failure, which holds the next back too
      const findReferences = registry.getOperation(
        OperationName.FIND_REFERENCES,
      )!;
      const events: string[] = [];
      const execute = spyOn(findReferences, 'execute').mockImplementation(
        async (input) => {
          events.push(`start ${input.text}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          events.push(`end ${input.text}`);
          return { success: false, message: 'Not found', filesChanged: [] };
        },
      );

      // Act
      await Promise.all([
        findReferencesFor('first'),
        findReferencesFor('second'),
      ]);
      execute.mockRestore();

      // Assert
      expect(events).toEqual([
        'start first',
        'end first',
        'start second',
        'end second',
      ]);
    });

    it('should run the next call once the one before it has thrown', async () => {
      // Arrange
      const findReferences = registry.getOperation(
        OperationName.FIND_REFERENCES,
      )!;
      const events: string[] = [];
      const execute = spyOn(findReferences, 'execute').mockImplementation(
        async (input) => {
          events.push(`start ${input.text}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (input.text === 'first') {
            events.push('first threw');
            throw new Error('tsserver exited');
          }
          return { success: true, message: 'Found', filesChanged: [] };
        },
      );

      // Act
      const [first, second] = await Promise.allSettled([
        findReferencesFor('first'),
        findReferencesFor('second'),
      ]);
      execute.mockRestore();

      // Assert
      expect(first.status).toBe('rejected');
      expect(second.status).toBe('fulfilled');
      expect(events).toEqual(['start first', 'first threw', 'start second']);
    });
  });
});
