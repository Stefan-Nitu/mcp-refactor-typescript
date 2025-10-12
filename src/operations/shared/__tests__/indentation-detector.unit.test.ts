import { describe, expect, it } from 'vitest';
import { IndentationDetector } from '../indentation-detector.js';

describe('IndentationDetector', () => {
  const detector = new IndentationDetector();

  describe('detect', () => {
    it('should detect 2-space indentation from following lines', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '  const y = 2;',
        '}'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should detect 4-space indentation from following lines', () => {
      // Arrange
      const lines = [
        'function test() {',
        '    const x = 1;',
        '    const y = 2;',
        '}'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('    ');
    });

    it('should detect tab indentation', () => {
      // Arrange
      const lines = [
        'function test() {',
        '\tconst x = 1;',
        '\tconst y = 2;',
        '}'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('\t');
    });

    it('should detect indentation from preceding lines when no following lines', () => {
      // Arrange
      const lines = [
        'function test() {',
        '  const x = 1;',
        '  const y = 2;',
        '}'
      ];

      // Act
      const indent = detector.detect(lines, 3);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should skip empty lines when detecting indentation', () => {
      // Arrange
      const lines = [
        'function test() {',
        '',
        '',
        '  const x = 1;',
        '}'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should return empty string when detecting module-level (no indented lines found)', () => {
      // Arrange
      const lines = [
        'const x = 1;',
        'const y = 2;'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('');
    });

    it('should detect indentation within search window (3 lines ahead)', () => {
      // Arrange
      const lines = [
        'function test() {',
        '',
        '',
        '',
        '    const farAway = 1;',  // 4 lines away, outside window
        ''
      ];

      // Act - should not find indentation 4+ lines away
      const indent = detector.detect(lines, 0);

      // Assert - returns empty string for module-level when no indent found in window
      expect(indent).toBe('');
    });

    it('should detect indentation within search window (3 lines behind)', () => {
      // Arrange
      const lines = [
        '    const farAway = 1;',  // 4 lines before
        '',
        '',
        '',
        'function test() {',
        ''
      ];

      // Act
      const indent = detector.detect(lines, 4);

      // Assert - returns empty string for module-level when no indent found in window
      expect(indent).toBe('');
    });

    it('should detect from line within window', () => {
      // Arrange
      const lines = [
        'function test() {',
        '',
        '    const x = 1;',  // 2 lines away, within window
        ''
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('    ');
    });

    it('should handle edge case at start of file', () => {
      // Arrange
      const lines = [
        '',
        '  const x = 1;'
      ];

      // Act
      const indent = detector.detect(lines, 0);

      // Assert
      expect(indent).toBe('  ');
    });

    it('should handle edge case at end of file', () => {
      // Arrange
      const lines = [
        '  const x = 1;',
        ''
      ];

      // Act
      const indent = detector.detect(lines, 1);

      // Assert
      expect(indent).toBe('  ');
    });
  });
});
