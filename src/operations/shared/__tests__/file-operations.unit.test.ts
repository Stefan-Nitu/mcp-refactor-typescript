import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileOperations } from '../file-operations.js';

describe('FileOperations', () => {
  const operations = new FileOperations();
  const testDir = join(process.cwd(), '.test-file-operations');

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readLines', () => {
    it('should read file and split into lines', async () => {
      // Arrange
      const filePath = join(testDir, 'test-read.ts');
      await writeFile(filePath, 'line 1\nline 2\nline 3', 'utf-8');

      // Act
      const lines = await operations.readLines(filePath);

      // Assert
      expect(lines).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('should handle single line file', async () => {
      // Arrange
      const filePath = join(testDir, 'single-line.ts');
      await writeFile(filePath, 'single line', 'utf-8');

      // Act
      const lines = await operations.readLines(filePath);

      // Assert
      expect(lines).toEqual(['single line']);
    });

    it('should handle empty file', async () => {
      // Arrange
      const filePath = join(testDir, 'empty.ts');
      await writeFile(filePath, '', 'utf-8');

      // Act
      const lines = await operations.readLines(filePath);

      // Assert
      expect(lines).toEqual(['']);
    });

    it('should throw error for non-existent file', async () => {
      // Arrange
      const filePath = join(testDir, 'non-existent.ts');

      // Act & Assert
      await expect(operations.readLines(filePath)).rejects.toThrow();
    });
  });

  describe('writeLines', () => {
    it('should write lines to file', async () => {
      // Arrange
      const filePath = join(testDir, 'test-write.ts');
      const lines = ['line 1', 'line 2', 'line 3'];

      // Act
      await operations.writeLines(filePath, lines);

      // Assert
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('line 1\nline 2\nline 3');
    });

    it('should write single line', async () => {
      // Arrange
      const filePath = join(testDir, 'single-write.ts');
      const lines = ['single line'];

      // Act
      await operations.writeLines(filePath, lines);

      // Assert
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('single line');
    });

    it('should overwrite existing file', async () => {
      // Arrange
      const filePath = join(testDir, 'overwrite.ts');
      await writeFile(filePath, 'old content', 'utf-8');
      const lines = ['new content'];

      // Act
      await operations.writeLines(filePath, lines);

      // Assert
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('new content');
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative path to absolute', () => {
      // Arrange
      const relativePath = 'src/test.ts';

      // Act
      const absolutePath = operations.resolvePath(relativePath);

      // Assert
      expect(absolutePath).toContain(process.cwd());
      expect(absolutePath).toContain('src/test.ts');
      expect(absolutePath).toMatch(/^\//);
    });

    it('should return absolute path unchanged', () => {
      // Arrange
      const absolutePath = '/Users/test/project/src/file.ts';

      // Act
      const result = operations.resolvePath(absolutePath);

      // Assert
      expect(result).toBe(absolutePath);
    });

    it('should handle paths with .. and .', () => {
      // Arrange
      const complexPath = './src/../lib/./file.ts';

      // Act
      const resolved = operations.resolvePath(complexPath);

      // Assert
      expect(resolved).not.toContain('..');
      expect(resolved).not.toContain('./');
      expect(resolved).toContain('lib/file.ts');
    });
  });
});
