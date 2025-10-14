import { describe, expect, it } from 'vitest';
import { IndentationDetector } from '../indentation-detector.js';

describe('IndentationDetector', () => {
  const detector = new IndentationDetector();

  describe('detectIndentUnit', () => {
    it('should detect 2-space indentation from whole file', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '  if (x) {',
        '    const y = 2;',
        '    return y;',
        '  }',
        '  return x;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should detect 4-space indentation from whole file', () => {
      // Arrange
      const lines = [
        'function test() {',
        '    const x = 1;',
        '    if (x) {',
        '        const y = 2;',
        '        return y;',
        '    }',
        '    return x;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('    ');
    });

    it('should detect tab indentation from whole file', () => {
      // Arrange
      const lines = [
        'function test() {',
        '\tconst x = 1;',
        '\tif (x) {',
        '\t\tconst y = 2;',
        '\t\treturn y;',
        '\t}',
        '\treturn x;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('\t');
    });

    it('should detect 2-space indentation when mixed with alignment', () => {
      // Arrange
      const lines = [
        'const obj = {',
        '  foo: 1,',
        '  bar: 2,',
        '  baz:   3  // extra spaces for alignment',
        '};',
        '',
        'function test() {',
        '  return obj;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert - Should detect 2 spaces, not be confused by alignment
      expect(indent).toBe('  ');
    });

    it('should handle file with no indentation', () => {
      // Arrange
      const lines = [
        'const x = 1;',
        'const y = 2;',
        'export { x, y };'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert - Should return empty string for module-level
      expect(indent).toBe('');
    });

    it('should skip empty lines and comments when detecting', () => {
      // Arrange
      const lines = [
        '// This is a comment',
        '',
        'function test() {',
        '  // Indented comment',
        '  ',
        '  const x = 1;',
        '  const y = 2;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should handle nested structures correctly', () => {
      // Arrange
      const lines = [
        'class Calculator {',
        '  process(x: number) {',
        '    if (x > 0) {',
        '      return x * 2;',
        '    }',
        '    return 0;',
        '  }',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should prefer most common indent over rare larger indents', () => {
      // Arrange - Mostly 2-space with one 4-space outlier
      const lines = [
        'function test() {',
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 3;',
        '  const d = 4;',
        '    const outlier = 5;  // 4-space indent (rare)',
        '  const e = 6;',
        '  return a + b + c + d + e;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert - Should detect 2 spaces as most common
      expect(indent).toBe('  ');
    });

    it('should handle 3-space indentation', () => {
      // Arrange
      const lines = [
        'function test() {',
        '   const x = 1;',
        '   if (x) {',
        '      const y = 2;',
        '      return y;',
        '   }',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnit(lines);

      // Assert
      expect(indent).toBe('   ');
    });
  });

  describe('getIndentAtNestingLevel', () => {
    it('should return correct indentation for nesting level 0', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '}'
      ];
      const indentUnit = detector.detectIndentUnit(lines);

      // Act
      const indent = detector.getIndentAtNestingLevel(indentUnit, 0);

      // Assert
      expect(indent).toBe('');
    });

    it('should return correct indentation for nesting level 1', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '}'
      ];
      const indentUnit = detector.detectIndentUnit(lines);

      // Act
      const indent = detector.getIndentAtNestingLevel(indentUnit, 1);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should return correct indentation for nesting level 2', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  if (true) {',
        '    const x = 1;',
        '  }',
        '}'
      ];
      const indentUnit = detector.detectIndentUnit(lines);

      // Act
      const indent = detector.getIndentAtNestingLevel(indentUnit, 2);

      // Assert
      expect(indent).toBe('    ');
    });

    it('should work with tab indentation', () => {
      // Arrange
      const lines = [
        'function test() {',
        '\tconst x = 1;',
        '}'
      ];
      const indentUnit = detector.detectIndentUnit(lines);

      // Act
      const indent = detector.getIndentAtNestingLevel(indentUnit, 2);

      // Assert
      expect(indent).toBe('\t\t');
    });
  });

  describe('detectIndentUnitOrDefault', () => {
    it('should detect indentation when present', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnitOrDefault(lines);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should return default when no indentation detected', () => {
      // Arrange
      const lines = [
        'const x = 1;',
        'const y = 2;'
      ];

      // Act
      const indent = detector.detectIndentUnitOrDefault(lines);

      // Assert
      expect(indent).toBe('  '); // Default to 2 spaces
    });

    it('should detect tabs when present', () => {
      // Arrange
      const lines = [
        'function test() {',
        '\tconst x = 1;',
        '}'
      ];

      // Act
      const indent = detector.detectIndentUnitOrDefault(lines);

      // Assert
      expect(indent).toBe('\t');
    });
  });

  describe('detectNestingLevel', () => {
    it('should detect nesting level 0 for module-level code', () => {
      // Arrange
      const line = 'const x = 1;';
      const indentUnit = '  ';

      // Act
      const level = detector.detectNestingLevel(line, indentUnit);

      // Assert
      expect(level).toBe(0);
    });

    it('should detect nesting level 1 for single-indented code', () => {
      // Arrange
      const line = '  const x = 1;';
      const indentUnit = '  ';

      // Act
      const level = detector.detectNestingLevel(line, indentUnit);

      // Assert
      expect(level).toBe(1);
    });

    it('should detect nesting level 2 for double-indented code', () => {
      // Arrange
      const line = '    const x = 1;';
      const indentUnit = '  ';

      // Act
      const level = detector.detectNestingLevel(line, indentUnit);

      // Assert
      expect(level).toBe(2);
    });

    it('should handle tab indentation', () => {
      // Arrange
      const line = '\t\t\tconst x = 1;';
      const indentUnit = '\t';

      // Act
      const level = detector.detectNestingLevel(line, indentUnit);

      // Assert
      expect(level).toBe(3);
    });

    it('should return 0 for empty lines', () => {
      // Arrange
      const line = '';
      const indentUnit = '  ';

      // Act
      const level = detector.detectNestingLevel(line, indentUnit);

      // Assert
      expect(level).toBe(0);
    });
  });
});
