/**
 * Tests for turning an operation's `line` + `text` into a column range.
 *
 * `text` used to be located with a bare indexOf, so `user` matched the start
 * of `username`, and a rename aimed at the parameter renamed the variable and
 * still reported success.
 */

import { describe, expect, it } from 'bun:test';
import { TextPositionConverter } from '../text-position-converter.js';

describe('TextPositionConverter', () => {
  const converter = new TextPositionConverter();

  describe('findTextPosition', () => {
    it('should find text position on valid line', () => {
      // Arrange
      const lines = [
        'export function calculateSum(a: number, b: number): number {',
        '  return a + b;',
        '}',
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
        '}',
      ];

      // Act
      const result = converter.findTextPosition(lines, 1, 'nonexistent');

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain(
          'Text "nonexistent" not found on line 1',
        );
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

    describe('identifier boundaries', () => {
      it('should skip an occurrence that runs on into a longer identifier', () => {
        // Arrange
        const lines = [
          '  const username = user.toUpperCase(); return username;',
        ];

        // Act
        const result = converter.findTextPosition(lines, 1, 'user');

        // Assert
        expect(result).toMatchObject({
          success: true,
          startColumn: 20,
          endColumn: 24,
        });
      });

      it('should skip an occurrence that ends a longer identifier', () => {
        // Arrange
        const lines = ['  return subtotal + total;'];

        // Act
        const result = converter.findTextPosition(lines, 1, 'total');

        // Assert
        expect(result).toMatchObject({
          success: true,
          startColumn: 21,
          endColumn: 26,
        });
      });

      it('should treat $, _ and digits as identifier characters', () => {
        // Arrange
        const lines = ['  return $el + el2 + _el + el;'];

        // Act
        const result = converter.findTextPosition(lines, 1, 'el');

        // Assert
        expect(result).toMatchObject({ success: true, startColumn: 28 });
      });

      it('should treat non-ASCII letters as identifier characters', () => {
        // Arrange
        const lines = ['const Δx = x + Δ;'];

        // Act
        const x = converter.findTextPosition(lines, 1, 'x');
        const delta = converter.findTextPosition(lines, 1, 'Δ');

        // Assert
        expect(x).toMatchObject({ success: true, startColumn: 12 });
        expect(delta).toMatchObject({ success: true, startColumn: 16 });
      });

      it('should fail when the text only appears inside longer identifiers', () => {
        // Arrange
        const lines = ['  const username = superuser;'];

        // Act
        const result = converter.findTextPosition(lines, 1, 'user');

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.message).toContain(
            'Text "user" only appears as part of a longer identifier on line 1',
          );
          expect(result.message).toContain(
            'Line content:   const username = superuser;',
          );
        }
      });

      it('should match a selection that begins right after an identifier', () => {
        // Arrange
        const lines = ['  return add(a, b);'];

        // Act
        const result = converter.findTextPosition(lines, 1, '(a, b)');

        // Assert
        expect(result).toMatchObject({
          success: true,
          startColumn: 13,
          endColumn: 19,
        });
      });

      it('should match a selection that ends right before an identifier', () => {
        // Arrange
        const lines = ['const user = <User>data;'];

        // Act
        const result = converter.findTextPosition(lines, 1, '<User>');

        // Assert
        expect(result).toMatchObject({
          success: true,
          startColumn: 14,
          endColumn: 20,
        });
      });
    });
  });
});
