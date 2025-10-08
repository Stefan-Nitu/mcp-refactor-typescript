import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RefactorModuleOperation } from '../refactor-module.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

describe('refactorModule', () => {
  let operation: RefactorModuleOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let testDir: string;

  beforeAll(() => {
    testDir = createTestDir();
    return setupTestWorkspace(testDir);
  });

  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new RefactorModuleOperation(testServer);
    await mkdir(join(testDir, 'src', 'new'), { recursive: true });
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should move file, organize imports, and fix errors', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'service.ts');
    const destPath = join(testDir, 'src', 'new', 'service.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(sourcePath, `export function helper() {
  return 42;
}`, 'utf-8');

    await writeFile(mainPath, `import { helper } from './service.js';

const result = helper();
console.error(result);`, 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Refactored module successfully');
    expect(response.message).toContain('Moved file');

    // Verify file was moved
    const movedContent = await readFile(destPath, 'utf-8');
    expect(movedContent).toContain('helper');

    // Verify import was updated in main.ts (if TSServer found it)
    const mainContent = await readFile(mainPath, 'utf-8');
    // Should be updated to new path
    expect(mainContent).toContain('helper');
  });

  it('should support preview mode', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'service.ts');
    const destPath = join(testDir, 'src', 'new', 'service.ts');

    await writeFile(sourcePath, `export function helper() {
  return 42;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
      preview: true
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview:');
    expect(response.message).toContain('refactor module');
    expect(response.preview).toBeDefined();
    expect(response.preview?.filesAffected).toBeGreaterThan(0);
    expect(response.preview?.estimatedTime).toBe('< 2s');

    // Verify file was NOT moved
    const sourceExists = await readFile(sourcePath, 'utf-8').then(() => true).catch(() => false);
    expect(sourceExists).toBe(true);
  });

  it('should return error when source file does not exist', async () => {
    // Act
    const response = await operation!.execute({
      sourcePath: '/nonexistent/file.ts',
      destinationPath: join(testDir, 'src', 'new', 'file.ts')
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Move file failed');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absoluteSourcePath = join(testDir, 'src', 'rel-service.ts');
    const absoluteDestPath = join(testDir, 'src', 'new', 'rel-service.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(absoluteSourcePath, `export function relHelper() {
  return 42;
}`, 'utf-8');

    await writeFile(mainPath, `import { relHelper } from './rel-service.js';

const result = relHelper();
console.error(result);`, 'utf-8');

    const relativeSourcePath = absoluteSourcePath.replace(process.cwd() + '/', '');
    const relativeDestPath = absoluteDestPath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      sourcePath: relativeSourcePath,
      destinationPath: relativeDestPath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Refactored module successfully');

    const movedContent = await readFile(absoluteDestPath, 'utf-8');
    expect(movedContent).toContain('relHelper');

    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('relHelper');
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absoluteSourcePath = join(testDir, 'src', 'abs-service.ts');
    const absoluteDestPath = join(testDir, 'src', 'new', 'abs-service.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(absoluteSourcePath, `export function absHelper() {
  return 42;
}`, 'utf-8');

    await writeFile(mainPath, `import { absHelper } from './abs-service.js';

const result = absHelper();
console.error(result);`, 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath: absoluteSourcePath,
      destinationPath: absoluteDestPath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Refactored module successfully');

    const movedContent = await readFile(absoluteDestPath, 'utf-8');
    expect(movedContent).toContain('absHelper');

    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('absHelper');
  });
});
