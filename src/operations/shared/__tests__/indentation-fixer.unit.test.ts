import { describe, expect, it } from 'vitest';
import { IndentationFixer } from '../indentation-fixer.js';
import { IndentationDetector } from '../indentation-detector.js';

describe('IndentationFixer', () => {
  const detector = new IndentationDetector();
  const fixer = new IndentationFixer(detector);

  describe('fixFunctionIndentation', () => {
    it('should fix function indentation from 4-space to 2-space', () => {
      // Arrange - TSServer extracts to MODULE scope (level 0)
      const originalLines = [
        'class Calculator {',
        '  process(x: number) {',
        '    const sum = x + x;',
        '    return sum;',
        '  }',
        '}'
      ];

      const tsServerOutput = `function newFunction(x: number) {
    return x + x;
}`;

      const targetLineIndex = 2; // Extracting from line 2 (level 2)

      // Act
      const fixed = fixer.fixFunctionIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert - Function extracted at module level (0), body at level 1
      expect(fixed).toContain('function newFunction(x: number) {');
      expect(fixed).toContain('  return x + x;');  // 2 spaces (level 1 with 2-space indent)
      expect(fixed).not.toContain('    return x + x;');  // Not 4 spaces
    });

    it('should preserve tab indentation', () => {
      // Arrange
      const originalLines = [
        'class Calculator {',
        '\tprocess(x: number) {',
        '\t\tconst sum = x + x;',
        '\t\treturn sum;',
        '\t}',
        '}'
      ];

      const tsServerOutput = `function newFunction(x: number) {
    return x + x;
}`;

      const targetLineIndex = 2;

      // Act
      const fixed = fixer.fixFunctionIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert
      expect(fixed).toContain('function newFunction(x: number) {');
      expect(fixed).toContain('\treturn x + x;');
    });

    it('should handle module-level extraction (no indentation)', () => {
      // Arrange - Already at module level
      const originalLines = [
        'const x = 1;',
        'const y = 2;',
        'const result = x + y;'
      ];

      const tsServerOutput = `function newFunction(x: number, y: number) {
    return x + y;
}`;

      const targetLineIndex = 2;

      // Act
      const fixed = fixer.fixFunctionIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert - Module level function (0), body at level 1
      expect(fixed).toContain('function newFunction(x: number, y: number) {');
      expect(fixed).toContain('  return x + y;');  // 2 spaces (level 1)
      expect(fixed).not.toMatch(/^\s+function/);  // Function has no leading spaces
    });

    it('should handle nested extraction (deeper nesting)', () => {
      // Arrange - TSServer extracts to MODULE scope
      const originalLines = [
        'class Outer {',
        '  method() {',
        '    if (true) {',
        '      const x = 1 + 2;',
        '    }',
        '  }',
        '}'
      ];

      const tsServerOutput = `function newFunction() {
    return 1 + 2;
}`;

      const targetLineIndex = 3; // Inside if block (level 3)

      // Act
      const fixed = fixer.fixFunctionIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert - Extracted to module level (0), body at level 1
      expect(fixed).toContain('function newFunction() {');
      expect(fixed).toContain('  return 1 + 2;'); // 2 spaces (level 1)
      expect(fixed).not.toMatch(/^\s+function/);  // Function at module level
    });
  });

  describe('fixConstantIndentation', () => {
    it('should fix constant indentation to match surrounding code', () => {
      // Arrange
      const originalLines = [
        'function test() {',
        '  const tax = 0.15 * price;',
        '  return tax;',
        '}'
      ];

      const tsServerOutput = 'const TAX_RATE = 0.15;';
      const targetLineIndex = 1;

      // Act
      const fixed = fixer.fixConstantIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert
      expect(fixed).toBe('  const TAX_RATE = 0.15;');
    });

    it('should handle module-level constant extraction', () => {
      // Arrange
      const originalLines = [
        'const x = 42;',
        'const y = 42;'
      ];

      const tsServerOutput = 'const ANSWER = 42;';
      const targetLineIndex = 0;

      // Act
      const fixed = fixer.fixConstantIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert
      expect(fixed).toBe('const ANSWER = 42;');
      expect(fixed).not.toMatch(/^\s/);
    });

    it('should handle nested constant extraction', () => {
      // Arrange
      const originalLines = [
        'class Config {',
        '  setup() {',
        '    const timeout = 5000;',
        '  }',
        '}'
      ];

      const tsServerOutput = 'const TIMEOUT_MS = 5000;';
      const targetLineIndex = 2;

      // Act
      const fixed = fixer.fixConstantIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert
      expect(fixed).toBe('    const TIMEOUT_MS = 5000;');
    });
  });

  describe('fixVariableIndentation', () => {
    it('should fix variable indentation to match surrounding code', () => {
      // Arrange
      const originalLines = [
        'function process() {',
        '  const result = calculateValue(x, y);',
        '  return result;',
        '}'
      ];

      const tsServerOutput = 'const newLocal = calculateValue(x, y);';
      const targetLineIndex = 1;

      // Act
      const fixed = fixer.fixVariableIndentation(tsServerOutput, originalLines, targetLineIndex);

      // Assert
      expect(fixed).toBe('  const newLocal = calculateValue(x, y);');
    });
  });
});
