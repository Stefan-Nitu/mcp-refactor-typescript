import { describe, expect, it } from 'vitest';
import type { TSTextChange } from '../../../language-servers/typescript/tsserver-types.js';
import { EditApplicator } from '../edit-applicator.js';

describe('EditApplicator', () => {
  const applicator = new EditApplicator();

  describe('sortEdits', () => {
    it('should sort edits in reverse order by line', () => {
      // Arrange
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 1 }, end: { line: 1, offset: 5 }, newText: 'a' },
        { start: { line: 3, offset: 1 }, end: { line: 3, offset: 5 }, newText: 'c' },
        { start: { line: 2, offset: 1 }, end: { line: 2, offset: 5 }, newText: 'b' }
      ];

      // Act
      const sorted = applicator.sortEdits(changes);

      // Assert
      expect(sorted[0].start.line).toBe(3);
      expect(sorted[1].start.line).toBe(2);
      expect(sorted[2].start.line).toBe(1);
    });

    it('should sort edits in reverse order by offset when on same line', () => {
      // Arrange
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 5 }, end: { line: 1, offset: 10 }, newText: 'a' },
        { start: { line: 1, offset: 15 }, end: { line: 1, offset: 20 }, newText: 'c' },
        { start: { line: 1, offset: 10 }, end: { line: 1, offset: 15 }, newText: 'b' }
      ];

      // Act
      const sorted = applicator.sortEdits(changes);

      // Assert
      expect(sorted[0].start.offset).toBe(15);
      expect(sorted[1].start.offset).toBe(10);
      expect(sorted[2].start.offset).toBe(5);
    });

    it('should not mutate original array', () => {
      // Arrange
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 1 }, end: { line: 1, offset: 5 }, newText: 'a' },
        { start: { line: 2, offset: 1 }, end: { line: 2, offset: 5 }, newText: 'b' }
      ];
      const original = [...changes];

      // Act
      applicator.sortEdits(changes);

      // Assert
      expect(changes).toEqual(original);
    });
  });

  describe('applyEdits', () => {
    it('should apply single-line edit', () => {
      // Arrange
      const lines = ['const oldName = 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 14 }, newText: 'newName' }
      ];

      // Act
      const result = applicator.applyEdits(lines, changes);

      // Assert
      expect(result).toEqual(['const newName = 1;']);
    });

    it('should apply multiple edits on same line', () => {
      // Arrange
      const lines = ['const x = x + 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 11 }, end: { line: 1, offset: 12 }, newText: 'y' },
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 8 }, newText: 'y' }
      ];

      // Act
      const sorted = applicator.sortEdits(changes);
      const result = applicator.applyEdits(lines, sorted);

      // Assert
      expect(result).toEqual(['const y = y + 1;']);
    });

    it('should apply edits across multiple lines', () => {
      // Arrange
      const lines = [
        'const oldName = 1;',
        'console.error(oldName);'
      ];
      const changes: TSTextChange[] = [
        { start: { line: 2, offset: 15 }, end: { line: 2, offset: 22 }, newText: 'newName' },
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 14 }, newText: 'newName' }
      ];

      // Act
      const sorted = applicator.sortEdits(changes);
      const result = applicator.applyEdits(lines, sorted);

      // Assert
      expect(result).toEqual([
        'const newName = 1;',
        'console.error(newName);'
      ]);
    });

    it('should handle multi-line edit (spanning lines)', () => {
      // Arrange
      const lines = [
        'const x = {',
        '  a: 1,',
        '  b: 2',
        '};'
      ];
      const changes: TSTextChange[] = [
        {
          start: { line: 2, offset: 1 },
          end: { line: 3, offset: 7 },
          newText: '  c: 3'
        }
      ];

      // Act
      const result = applicator.applyEdits(lines, changes);

      // Assert
      expect(result).toEqual([
        'const x = {',
        '  c: 3',
        '};'
      ]);
    });

    it('should handle insertion (empty old text)', () => {
      // Arrange
      const lines = ['const x = 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 1 }, end: { line: 1, offset: 1 }, newText: 'export ' }
      ];

      // Act
      const result = applicator.applyEdits(lines, changes);

      // Assert
      expect(result).toEqual(['export const x = 1;']);
    });

    it('should handle deletion (empty new text)', () => {
      // Arrange
      const lines = ['export const x = 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 1 }, end: { line: 1, offset: 8 }, newText: '' }
      ];

      // Act
      const result = applicator.applyEdits(lines, changes);

      // Assert
      expect(result).toEqual(['const x = 1;']);
    });

    it('should not mutate original lines array', () => {
      // Arrange
      const lines = ['const oldName = 1;'];
      const original = [...lines];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 14 }, newText: 'newName' }
      ];

      // Act
      applicator.applyEdits(lines, changes);

      // Assert
      expect(lines).toEqual(original);
    });
  });

  describe('buildFileChanges', () => {
    it('should build file changes object', () => {
      // Arrange
      const originalLines = ['const oldName = 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 14 }, newText: 'newName' }
      ];
      const filePath = '/Users/test/project/src/file.ts';

      // Act
      const result = applicator.buildFileChanges(originalLines, changes, filePath);

      // Assert
      expect(result.file).toBe('file.ts');
      expect(result.path).toBe(filePath);
      expect(result.edits).toHaveLength(1);
      expect(result.edits[0]).toEqual({
        line: 1,
        column: 7,
        old: 'oldName',
        new: 'newName'
      });
    });

    it('should extract old text correctly from original lines', () => {
      // Arrange
      const originalLines = [
        'const value = 3.14159;',
        'console.error(value);'
      ];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 15 }, end: { line: 1, offset: 22 }, newText: 'PI' }
      ];
      const filePath = '/test/file.ts';

      // Act
      const result = applicator.buildFileChanges(originalLines, changes, filePath);

      // Assert
      expect(result.edits[0].old).toBe('3.14159');
      expect(result.edits[0].new).toBe('PI');
    });

    it('should handle multiple changes', () => {
      // Arrange
      const originalLines = ['const x = x + 1;'];
      const changes: TSTextChange[] = [
        { start: { line: 1, offset: 7 }, end: { line: 1, offset: 8 }, newText: 'y' },
        { start: { line: 1, offset: 11 }, end: { line: 1, offset: 12 }, newText: 'y' }
      ];
      const filePath = '/test/file.ts';

      // Act
      const result = applicator.buildFileChanges(originalLines, changes, filePath);

      // Assert
      expect(result.edits).toHaveLength(2);
    });
  });
});
