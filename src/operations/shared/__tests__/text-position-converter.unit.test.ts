import { describe, expect, it } from 'vitest';
import { TextPositionConverter } from '../text-position-converter.js';

describe('TextPositionConverter', () => {
  const converter = new TextPositionConverter();

  describe('findTextPosition', () => {
    it('should find text position on valid line', () => {
      // Arrange
      const lines = [
        'export function calculateSum(a: number, b: number): number {',
        '  return a + b;',
        '}'
      ];

      // Act
      const result = converter.findTextPosition(lines, 1, 'calculateSum');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.startLine).toBe(1);
        expect(result.startColumn).toBe(17);
        expect(result.endLine).toBe(1);
        expect(result.endColumn).toBe(29);
      }
    });

    it('should return error when line is out of range (too high)', () => {
      // Arrange
      const lines = ['const x = 1;'];

      // Act
      const result = converter.findTextPosition(lines, 5, 'x');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Line 5 is out of range');
        expect(result.message).toContain('file has 1 lines');
      }
    });

    it('should return error when line is zero', () => {
      // Arrange
      const lines = ['const x = 1;'];

      // Act
      const result = converter.findTextPosition(lines, 0, 'x');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Line 0 is out of range');
      }
    });

    it('should return error when line is negative', () => {
      // Arrange
      const lines = ['const x = 1;'];

      // Act
      const result = converter.findTextPosition(lines, -1, 'x');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Line -1 is out of range');
      }
    });

    it('should return error when text not found on line', () => {
      // Arrange
      const lines = [
        'export function calculateSum(a: number, b: number): number {',
        '  return a + b;',
        '}'
      ];

      // Act
      const result = converter.findTextPosition(lines, 1, 'nonexistent');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Text "nonexistent" not found on line 1');
        expect(result.message).toContain('Line content:');
        expect(result.message).toContain('calculateSum');
      }
    });

    it('should find text at start of line', () => {
      // Arrange
      const lines = ['const x = 1;'];

      // Act
      const result = converter.findTextPosition(lines, 1, 'const');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.startColumn).toBe(1);
      }
    });

    it('should find text at end of line', () => {
      // Arrange
      const lines = ['const x = 42'];

      // Act
      const result = converter.findTextPosition(lines, 1, '42');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.startColumn).toBe(11);
        expect(result.endColumn).toBe(13);
      }
    });

    it('should handle multi-character text', () => {
      // Arrange
      const lines = ['const myVariable = "hello world";'];

      // Act
      const result = converter.findTextPosition(lines, 1, 'myVariable');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.startColumn).toBe(7);
        expect(result.endColumn).toBe(17);
      }
    });

    it('should find first occurrence when text appears multiple times', () => {
      // Arrange
      const lines = ['const x = x + 1;'];

      // Act
      const result = converter.findTextPosition(lines, 1, 'x');

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.startColumn).toBe(7);
      }
    });
  });
});
