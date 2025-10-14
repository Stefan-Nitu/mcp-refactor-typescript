import { describe, expect, it } from 'vitest';
import type { TSTextChange } from '../../language-servers/typescript/tsserver-types.js';
import { RefactoringProcessor } from '../refactoring-processor.js';

describe('RefactoringProcessor', () => {
  describe('const declarations', () => {
    it('should find generated const declaration in changes', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const changes: TSTextChange[] = [
        {
          start: { line: 2, offset: 1 },
          end: { line: 2, offset: 1 },
          newText: '  const newLocal = 42;\n'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toEqual({
        name: 'newLocal',
        line: 2,
        column: 9
      });
    });

    it('should return null when no const declaration found', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const changes: TSTextChange[] = [
        {
          start: { line: 1, offset: 5 },
          end: { line: 1, offset: 7 },
          newText: 'newLocal'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle multi-line changes with const on second line', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const changes: TSTextChange[] = [
        {
          start: { line: 5, offset: 1 },
          end: { line: 5, offset: 1 },
          newText: '\n  const myVar = value;\n'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toEqual({
        name: 'myVar',
        line: 6, // 5 + 1 (second line in newText)
        column: 9
      });
    });
  });

  describe('function declarations', () => {
    it('should find generated function declaration in changes', () => {
      // Arrange
      const processor = new RefactoringProcessor('function');
      const changes: TSTextChange[] = [
        {
          start: { line: 10, offset: 1 },
          end: { line: 10, offset: 1 },
          newText: 'function newFunction() {\n  return 42;\n}\n'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toEqual({
        name: 'newFunction',
        line: 10,
        column: 10
      });
    });

    it('should return null when no function declaration found', () => {
      // Arrange
      const processor = new RefactoringProcessor('function');
      const changes: TSTextChange[] = [
        {
          start: { line: 1, offset: 1 },
          end: { line: 1, offset: 10 },
          newText: 'myFunc()'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('multiple changes', () => {
    it('should find declaration in first matching change', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const changes: TSTextChange[] = [
        {
          start: { line: 1, offset: 5 },
          end: { line: 1, offset: 7 },
          newText: 'x'
        },
        {
          start: { line: 2, offset: 1 },
          end: { line: 2, offset: 1 },
          newText: '  const first = 1;\n'
        },
        {
          start: { line: 3, offset: 1 },
          end: { line: 3, offset: 1 },
          newText: '  const second = 2;\n'
        }
      ];

      // Act
      const result = processor.findDeclaration(changes);

      // Assert
      expect(result).toEqual({
        name: 'first',
        line: 2,
        column: 9
      });
    });
  });

  describe('updateFilesChangedAfterRename', () => {
    it('should update edits with renamed identifier', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const filesChanged = [{
        file: 'test.ts',
        path: '/test.ts',
        edits: [
          { line: 1, old: '42', new: 'newLocal' },
          { line: 2, old: 'x + y', new: 'newLocal' }
        ]
      }];

      // Act
      processor.updateFilesChangedAfterRename(filesChanged, 'newLocal', 'MY_CONSTANT', '/test.ts');

      // Assert
      expect(filesChanged[0].edits[0].new).toBe('MY_CONSTANT');
      expect(filesChanged[0].edits[1].new).toBe('MY_CONSTANT');
    });

    it('should only update edits in the specified file', () => {
      // Arrange
      const processor = new RefactoringProcessor('const');
      const filesChanged = [
        {
          file: 'test1.ts',
          path: '/test1.ts',
          edits: [{ line: 1, old: '42', new: 'newLocal' }]
        },
        {
          file: 'test2.ts',
          path: '/test2.ts',
          edits: [{ line: 1, old: '99', new: 'newLocal' }]
        }
      ];

      // Act
      processor.updateFilesChangedAfterRename(filesChanged, 'newLocal', 'CONST_ONE', '/test1.ts');

      // Assert
      expect(filesChanged[0].edits[0].new).toBe('CONST_ONE');
      expect(filesChanged[1].edits[0].new).toBe('newLocal'); // unchanged
    });

    it('should only replace whole word matches', () => {
      // Arrange
      const processor = new RefactoringProcessor('function');
      const filesChanged = [{
        file: 'test.ts',
        path: '/test.ts',
        edits: [
          { line: 1, old: 'x + y', new: 'newFunction(x, y)' },
          { line: 2, old: '', new: 'function newFunction(x, y) { return x + y; }' }
        ]
      }];

      // Act
      processor.updateFilesChangedAfterRename(filesChanged, 'newFunction', 'addNumbers', '/test.ts');

      // Assert
      expect(filesChanged[0].edits[0].new).toBe('addNumbers(x, y)');
      expect(filesChanged[0].edits[1].new).toBe('function addNumbers(x, y) { return x + y; }');
    });
  });
});
