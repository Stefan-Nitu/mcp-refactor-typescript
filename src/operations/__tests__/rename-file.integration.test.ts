import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { createRenameFileOperation } from '../shared/operation-factory.js';
import type { RenameFileOperation } from '../rename-file.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RenameFileOperation | null = null;

describe('rename-file', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createRenameFileOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  describe('basic file rename', () => {
    it('should rename file in same directory and update imports', async () => {
      // Arrange
      const oldPath = join(testDir, 'src', 'old-name.ts');
      const newPath = join(testDir, 'src', 'new-name.ts');

      const exportContent = `export function helper() {
  return 'helper';
}`;

      const importerPath = join(testDir, 'src', 'importer.ts');
      const importerContent = `import { helper } from './old-name.js';

export function useHelper() {
  return helper();
}`;

      await writeFile(oldPath, exportContent, 'utf-8');
      await writeFile(importerPath, importerContent, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: oldPath,
        name: 'new-name.ts'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.filesChanged.length).toBeGreaterThanOrEqual(1);

      const importerFileContent = await readFile(importerPath, 'utf-8');
      expect(importerFileContent).toContain('./new-name.js');
      expect(importerFileContent).not.toContain('./old-name.js');

      const newFileContent = await readFile(newPath, 'utf-8');
      expect(newFileContent).toContain('helper');
    });

    it('should handle file with multiple importers', async () => {
      // Arrange
      const oldPath = join(testDir, 'src', 'utils.ts');
      const newPath = join(testDir, 'src', 'utilities.ts');

      const utilsContent = `export const VERSION = '1.0.0';
export function getVersion() { return VERSION; }`;

      const importer1Path = join(testDir, 'src', 'main.ts');
      const importer1Content = `import { VERSION } from './utils.js';
console.error(VERSION);`;

      const importer2Path = join(testDir, 'src', 'config.ts');
      const importer2Content = `import { getVersion } from './utils.js';
export const version = getVersion();`;

      await writeFile(oldPath, utilsContent, 'utf-8');
      await writeFile(importer1Path, importer1Content, 'utf-8');
      await writeFile(importer2Path, importer2Content, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: oldPath,
        name: 'utilities.ts'
      });

      // Assert
      expect(response.success).toBe(true);

      const importer1FileContent = await readFile(importer1Path, 'utf-8');
      expect(importer1FileContent).toContain('./utilities.js');

      const importer2FileContent = await readFile(importer2Path, 'utf-8');
      expect(importer2FileContent).toContain('./utilities.js');

      const newFileContent = await readFile(newPath, 'utf-8');
      expect(newFileContent).toContain('VERSION');
    });
  });

  describe('preview mode', () => {
    it('should preview rename without actually renaming', async () => {
      // Arrange
      const oldPath = join(testDir, 'src', 'preview-test.ts');
      const originalContent = `export const TEST = 'test';`;

      await writeFile(oldPath, originalContent, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: oldPath,
        name: 'preview-renamed.ts',
        preview: true
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('Preview:');
      expect(response.preview).toBeDefined();

      const fileStillExists = await readFile(oldPath, 'utf-8').then(() => true).catch(() => false);
      expect(fileStillExists).toBe(true);

      const content = await readFile(oldPath, 'utf-8');
      expect(content).toBe(originalContent);
    });
  });

  describe('path handling', () => {
    it('should handle relative paths', async () => {
      // Arrange
      const absolutePath = join(testDir, 'src', 'relative-test.ts');
      const content = `export const VALUE = 42;`;
      await writeFile(absolutePath, content, 'utf-8');

      const relativePath = absolutePath.replace(process.cwd() + '/', '');

      // Act
      const response = await operation!.execute({
        sourcePath: relativePath,
        name: 'relative-renamed.ts'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('moved');
    });

    it('should handle absolute paths', async () => {
      // Arrange
      const absolutePath = join(testDir, 'src', 'absolute-test.ts');
      const content = `export const VALUE = 42;`;
      await writeFile(absolutePath, content, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: absolutePath,
        name: 'absolute-renamed.ts'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('moved');
    });
  });

  describe('error handling', () => {
    it('should return error when source file does not exist', async () => {
      // Act
      const response = await operation!.execute({
        sourcePath: '/nonexistent/file.ts',
        name: 'renamed.ts'
      });

      // Assert
      expect(response.success).toBe(false);
      expect(response.message).toContain('Rename file failed');
    });
  });

  describe('edge cases', () => {
    it('should handle renaming file with exports but no importers', async () => {
      // Arrange
      const oldPath = join(testDir, 'src', 'no-importers.ts');
      const content = `export function unused() { return 'unused'; }`;
      await writeFile(oldPath, content, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: oldPath,
        name: 'no-importers-renamed.ts'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('moved');
      expect(response.filesChanged).toEqual([]);
    });

    it('should preserve file extension in newName', async () => {
      // Arrange
      const oldPath = join(testDir, 'src', 'with-ext.ts');
      const newPath = join(testDir, 'src', 'renamed-with-ext.ts');
      const content = `export const FOO = 'foo';`;
      await writeFile(oldPath, content, 'utf-8');

      // Act
      const response = await operation!.execute({
        sourcePath: oldPath,
        name: 'renamed-with-ext.ts'
      });

      // Assert
      expect(response.success).toBe(true);
      expect(response.message).toContain('moved');

      const fileExists = await readFile(newPath, 'utf-8').then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
