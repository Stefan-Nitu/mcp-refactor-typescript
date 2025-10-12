import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { CleanupCodebaseOperation } from '../cleanup-codebase.js';
import { createCleanupCodebaseOperation } from '../shared/operation-factory.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

describe('cleanupCodebase', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let testDir: string;

  beforeAll(() => {
    testDir = createTestDir();
    return setupTestWorkspace(testDir);
  });

  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should cleanup multiple TypeScript files', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'file1.ts');
    const file2Path = join(testDir, 'src', 'file2.ts');

    // Use unsorted imports that can be organized
    await writeFile(file1Path, `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`, 'utf-8');

    await writeFile(file2Path, `import { b, a, c } from './utils.js';

const result = a + b + c;
console.error(result);`, 'utf-8');

    await writeFile(join(testDir, 'src', 'utils.ts'), `export const a = 1;
export const b = 2;
export const c = 3;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src')
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');
    expect(response.message).toContain('Processed');

    // Verify file1 imports were organized (alphabetically sorted)
    const file1Content = await readFile(file1Path, 'utf-8');
    // Should be sorted: a, b, c instead of c, a, b
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');

    // Verify file2 imports were organized
    const file2Content = await readFile(file2Path, 'utf-8');
    const file2FirstLine = file2Content.split('\n')[0];
    expect(file2FirstLine).toContain('{ a, b, c }');
  });

  it('should support preview mode', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'file1.ts');
    const originalContent = `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`;

    await writeFile(file1Path, originalContent, 'utf-8');
    await writeFile(join(testDir, 'src', 'utils.ts'), `export const a = 1;
export const b = 2;
export const c = 3;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src'),
      preview: true
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview:');
    expect(response.message).toContain('cleanup');
    expect(response.preview).toBeDefined();
    expect(response.preview?.filesAffected).toBeGreaterThan(0);
    expect(response.preview?.command).toContain('preview: false');

    // Verify file was NOT modified
    const fileContent = await readFile(file1Path, 'utf-8');
    expect(fileContent).toBe(originalContent);
  });

  it('should return error when directory is empty', async () => {
    // Arrange
    const emptyDir = join(testDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    // Act
    const response = await operation!.execute({
      directory: emptyDir
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('No TypeScript files found');
  });

  it('should remove unused exports', async () => {
    // Arrange
    const mainPath = join(testDir, 'src', 'main.ts');
    const utilsPath = join(testDir, 'src', 'utils.ts');

    await writeFile(mainPath, `import { usedFunc } from './utils.js';
console.log(usedFunc());`, 'utf-8');

    await writeFile(utilsPath, `export function usedFunc() {
  return 42;
}

export function unusedFunc() {
  return 100;
}`, 'utf-8');

    await writeFile(join(testDir, 'package.json'), JSON.stringify({
      name: 'test',
      type: 'module'
    }), 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src'),
      entrypoints: ['main\\.ts$'],
      deleteUnusedFiles: true
    });

    // Assert
    expect(response.success).toBe(true);

    // Verify unusedFunc was removed
    const utilsContent = await readFile(utilsPath, 'utf-8');
    expect(utilsContent).toContain('usedFunc');
    expect(utilsContent).not.toContain('unusedFunc');
  });

  it('should skip node_modules directory', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const nodeModulesDir = join(srcDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    await writeFile(join(srcDir, 'file.ts'), `const x = 1;
console.error(x);`, 'utf-8');

    await writeFile(join(nodeModulesDir, 'library.ts'), `const y = 2;
console.error(y);`, 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: srcDir
    });

    // Assert
    expect(response.success).toBe(true);
    // Should only process 1 file (not the one in node_modules)
    expect(response.message).toContain('Processed 1 TypeScript file');
  });

  it('should only report files that actually changed', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'clean-file.ts');
    const file2Path = join(testDir, 'src', 'needs-cleanup.ts');

    // File with already-organized imports (no changes needed)
    await writeFile(file1Path, `import { a, b, c } from './utils.js';

const x = a + b + c;
console.error(x);`, 'utf-8');

    // File with unsorted imports (needs organizing)
    await writeFile(file2Path, `import { c, b, a } from './utils.js';

const y = a + b + c;
console.error(y);`, 'utf-8');

    await writeFile(join(testDir, 'src', 'utils.ts'), `export const a = 1;
export const b = 2;
export const c = 3;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src')
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(Array.isArray(response.filesChanged)).toBe(true);

    // filesChanged should be array of objects with path and edits
    expect(response.filesChanged.length).toBe(1);

    const changedFile = response.filesChanged[0];
    expect(changedFile).toHaveProperty('path');
    expect(changedFile).toHaveProperty('edits');
    expect(changedFile.path).toBe(file2Path);
    expect(Array.isArray(changedFile.edits)).toBe(true);
    expect(changedFile.edits.length).toBeGreaterThan(0);

    // file1 should NOT be in filesChanged (was already clean)
    expect(response.filesChanged.every(f => f.path !== file1Path)).toBe(true);
  });

  it('should work with relative directory path', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const file1Path = join(srcDir, 'rel-file1.ts');

    await writeFile(file1Path, `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`, 'utf-8');

    await writeFile(join(srcDir, 'utils.ts'), `export const a = 1;
export const b = 2;
export const c = 3;`, 'utf-8');

    const relativeSrcDir = srcDir.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      directory: relativeSrcDir
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');

    const file1Content = await readFile(file1Path, 'utf-8');
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');
  });

  it('should work with absolute directory path', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const file1Path = join(srcDir, 'abs-file1.ts');

    await writeFile(file1Path, `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`, 'utf-8');

    await writeFile(join(srcDir, 'utils.ts'), `export const a = 1;
export const b = 2;
export const c = 3;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      directory: srcDir
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');

    const file1Content = await readFile(file1Path, 'utf-8');
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');
  });
});
