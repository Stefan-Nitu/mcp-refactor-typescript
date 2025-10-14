/**
 * Unit tests for grouped tool schema validation
 * Tests the BEHAVIOR of input validation, not implementation
 */

import { describe, expect, it } from 'vitest';
import { refactoringTool, codeQualityTool, fileOperationsTool, workspaceTool } from '../grouped-tools.js';
import { z } from 'zod';

describe('Grouped Tools Schema Validation', () => {
  describe('refactoring Tool Schema', () => {
    const schema = refactoringTool.inputSchema;

    describe('Common Required Fields', () => {
      it('should accept valid common fields for all operations', () => {
        // Arrange
        const validInput = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'myVariable',
          name: 'myRenamedVariable'
        };

        // Act & Assert
        expect(() => schema.parse(validInput)).not.toThrow();
      });

      it('should reject empty file path', () => {
        // Arrange
        const invalidInput = {
          operation: 'rename',
          filePath: '',
          line: 10,
          text: 'myVariable',
          name: 'newName'
        };

        // Act & Assert
        expect(() => schema.parse(invalidInput)).toThrow(z.ZodError);
        expect(() => schema.parse(invalidInput)).toThrow(/File path cannot be empty/);
      });

      it('should reject non-positive line numbers', () => {
        // Arrange
        const zeroLine = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 0,
          text: 'myVariable',
          name: 'newName'
        };

        // Act & Assert
        expect(() => schema.parse(zeroLine)).toThrow(z.ZodError);
        expect(() => schema.parse(zeroLine)).toThrow(/Line must be a positive integer/);
      });

      it('should reject non-integer line numbers', () => {
        // Arrange
        const floatLine = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10.5,
          text: 'myVariable',
          name: 'newName'
        };

        // Act & Assert
        expect(() => schema.parse(floatLine)).toThrow(z.ZodError);
      });

      it('should reject empty text field', () => {
        // Arrange
        const emptyText = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10,
          text: '',
          name: 'newName'
        };

        // Act & Assert
        expect(() => schema.parse(emptyText)).toThrow(z.ZodError);
        expect(() => schema.parse(emptyText)).toThrow(/Text cannot be empty/);
      });
    });

    describe('rename Operation', () => {
      it('should accept rename with name', () => {
        // Arrange
        const input = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'oldName',
          name: 'newName'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject rename without name (required)', () => {
        // Arrange
        const input = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'oldName'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/name is required for rename operation/);
      });

      it('should allow rename with preview mode', () => {
        // Arrange
        const input = {
          operation: 'rename',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'oldName',
          name: 'newName',
          preview: true
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });

    describe('extract_function Operation', () => {
      it('should accept extract_function with name', () => {
        // Arrange
        const input = {
          operation: 'extract_function',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'const x = 1;\nconst y = 2;',
          name: 'myFunction'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should accept extract_function without name (uses generated name)', () => {
        // Arrange
        const input = {
          operation: 'extract_function',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'const x = 1;\nconst y = 2;'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });

    describe('extract_constant Operation', () => {
      it('should accept extract_constant with name', () => {
        // Arrange
        const input = {
          operation: 'extract_constant',
          filePath: '/path/to/file.ts',
          line: 10,
          text: '42',
          name: 'MY_CONSTANT'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should accept extract_constant without name', () => {
        // Arrange
        const input = {
          operation: 'extract_constant',
          filePath: '/path/to/file.ts',
          line: 10,
          text: '42'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });

    describe('extract_variable Operation', () => {
      it('should accept extract_variable with name', () => {
        // Arrange
        const input = {
          operation: 'extract_variable',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'someExpression()',
          name: 'myVariable'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should accept extract_variable without name', () => {
        // Arrange
        const input = {
          operation: 'extract_variable',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'someExpression()'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });

    describe('infer_return_type Operation', () => {
      it('should accept infer_return_type without name field', () => {
        // Arrange
        const input = {
          operation: 'infer_return_type',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'function myFunction() { return 42; }'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should accept infer_return_type even with extraneous name field', () => {
        // Arrange
        const input = {
          operation: 'infer_return_type',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'function myFunction() { return 42; }',
          name: 'ignored'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });

    describe('Invalid Operations', () => {
      it('should reject unknown operations', () => {
        // Arrange
        const invalidOp = {
          operation: 'unknown_operation',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'test'
        };

        // Act & Assert
        expect(() => schema.parse(invalidOp)).toThrow(z.ZodError);
      });

      it('should reject missing required operation field', () => {
        // Arrange
        const missingOp = {
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'test'
        };

        // Act & Assert
        expect(() => schema.parse(missingOp)).toThrow(z.ZodError);
      });
    });
  });

  describe('code_quality Tool Schema', () => {
    const schema = codeQualityTool.inputSchema;

    it('should accept valid organize_imports operation', () => {
      // Arrange
      const input = {
        operation: 'organize_imports',
        filePath: '/path/to/file.ts'
      };

      // Act & Assert
      expect(() => schema.parse(input)).not.toThrow();
    });

    it('should accept valid fix_all operation', () => {
      // Arrange
      const input = {
        operation: 'fix_all',
        filePath: '/path/to/file.ts'
      };

      // Act & Assert
      expect(() => schema.parse(input)).not.toThrow();
    });

    it('should accept valid remove_unused operation', () => {
      // Arrange
      const input = {
        operation: 'remove_unused',
        filePath: '/path/to/file.ts'
      };

      // Act & Assert
      expect(() => schema.parse(input)).not.toThrow();
    });

    it('should reject empty file path', () => {
      // Arrange
      const invalid = {
        operation: 'organize_imports',
        filePath: ''
      };

      // Act & Assert
      expect(() => schema.parse(invalid)).toThrow(z.ZodError);
      expect(() => schema.parse(invalid)).toThrow(/File path cannot be empty/);
    });
  });

  describe('file_operations Tool Schema', () => {
    const schema = fileOperationsTool.inputSchema;

    describe('rename_file Operation', () => {
      it('should accept valid rename_file operation', () => {
        // Arrange
        const input = {
          operation: 'rename_file',
          sourcePath: '/path/to/old.ts',
          name: 'new.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject rename_file without sourcePath', () => {
        // Arrange
        const input = {
          operation: 'rename_file',
          name: 'new.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/sourcePath is required for rename_file/);
      });

      it('should reject rename_file without name', () => {
        // Arrange
        const input = {
          operation: 'rename_file',
          sourcePath: '/path/to/old.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/name is required for rename_file/);
      });
    });

    describe('move_file Operation', () => {
      it('should accept valid move_file operation', () => {
        // Arrange
        const input = {
          operation: 'move_file',
          sourcePath: '/path/to/file.ts',
          destinationPath: '/new/path/file.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject move_file without sourcePath', () => {
        // Arrange
        const input = {
          operation: 'move_file',
          destinationPath: '/new/path/file.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/sourcePath is required for move_file/);
      });

      it('should reject move_file without destinationPath', () => {
        // Arrange
        const input = {
          operation: 'move_file',
          sourcePath: '/path/to/file.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/destinationPath is required for move_file/);
      });
    });

    describe('batch_move_files Operation', () => {
      it('should accept valid batch_move_files operation', () => {
        // Arrange
        const input = {
          operation: 'batch_move_files',
          files: ['/path/to/file1.ts', '/path/to/file2.ts'],
          targetFolder: '/new/folder'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject batch_move_files without files', () => {
        // Arrange
        const input = {
          operation: 'batch_move_files',
          targetFolder: '/new/folder'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/files is required for batch_move_files/);
      });

      it('should reject batch_move_files without targetFolder', () => {
        // Arrange
        const input = {
          operation: 'batch_move_files',
          files: ['/path/to/file1.ts']
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/targetFolder is required for batch_move_files/);
      });
    });
  });

  describe('workspace Tool Schema', () => {
    const schema = workspaceTool.inputSchema;

    describe('find_references Operation', () => {
      it('should accept valid find_references operation', () => {
        // Arrange
        const input = {
          operation: 'find_references',
          filePath: '/path/to/file.ts',
          line: 10,
          text: 'myFunction'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject find_references without filePath', () => {
        // Arrange
        const input = {
          operation: 'find_references',
          line: 10,
          text: 'myFunction'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/filePath is required for find_references/);
      });

      it('should reject find_references without line', () => {
        // Arrange
        const input = {
          operation: 'find_references',
          filePath: '/path/to/file.ts',
          text: 'myFunction'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/line is required for find_references/);
      });

      it('should reject find_references without text', () => {
        // Arrange
        const input = {
          operation: 'find_references',
          filePath: '/path/to/file.ts',
          line: 10
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/text is required for find_references/);
      });
    });

    describe('refactor_module Operation', () => {
      it('should accept valid refactor_module operation', () => {
        // Arrange
        const input = {
          operation: 'refactor_module',
          sourcePath: '/path/to/old.ts',
          destinationPath: '/path/to/new.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject refactor_module without sourcePath', () => {
        // Arrange
        const input = {
          operation: 'refactor_module',
          destinationPath: '/path/to/new.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/sourcePath is required for refactor_module/);
      });

      it('should reject refactor_module without destinationPath', () => {
        // Arrange
        const input = {
          operation: 'refactor_module',
          sourcePath: '/path/to/old.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/destinationPath is required for refactor_module/);
      });
    });

    describe('cleanup_codebase Operation', () => {
      it('should accept valid cleanup_codebase operation', () => {
        // Arrange
        const input = {
          operation: 'cleanup_codebase',
          directory: '/path/to/src',
          entrypoints: ['index.ts', 'main.ts']
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject cleanup_codebase without directory', () => {
        // Arrange
        const input = {
          operation: 'cleanup_codebase',
          entrypoints: ['index.ts', 'main.ts']
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/directory is required for cleanup_codebase/);
      });

      it('should accept cleanup_codebase without entrypoints when deleteUnusedFiles is not set', () => {
        // Arrange
        const input = {
          operation: 'cleanup_codebase',
          directory: '/path/to/src'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should reject cleanup_codebase without entrypoints when deleteUnusedFiles is true', () => {
        // Arrange
        const input = {
          operation: 'cleanup_codebase',
          directory: '/path/to/src',
          deleteUnusedFiles: true
        };

        // Act & Assert
        expect(() => schema.parse(input)).toThrow(z.ZodError);
        expect(() => schema.parse(input)).toThrow(/entrypoints is required when deleteUnusedFiles: true/);
      });
    });

    describe('restart_tsserver Operation', () => {
      it('should accept valid restart_tsserver operation with no parameters', () => {
        // Arrange
        const input = {
          operation: 'restart_tsserver'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });

      it('should accept restart_tsserver with extraneous fields', () => {
        // Arrange
        const input = {
          operation: 'restart_tsserver',
          filePath: 'ignored.ts'
        };

        // Act & Assert
        expect(() => schema.parse(input)).not.toThrow();
      });
    });
  });
});
