import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { RefactorModuleOperation } from '../refactor-module.js';
import { createRefactorModuleOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

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
    operation = createRefactorModuleOperation(testServer);
    await mkdir(join(testDir, 'src', 'new'), { recursive: true });
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should move file, organize imports, and fix errors', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'service.ts');
    const destPath = join(testDir, 'src', 'new', 'service.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(
      sourcePath,
      `export function helper() {
  return 42;
}`,
      'utf-8',
    );

    await writeFile(
      mainPath,
      `import { helper } from './service.js';

const result = helper();
console.error(result);`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
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

    await writeFile(
      sourcePath,
      `export function helper() {
  return 42;
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
      preview: true,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview:');
    expect(response.message).toContain('refactor module');
    expect(response.preview).toBeDefined();
    expect(response.preview?.filesAffected).toBeGreaterThan(0);
    expect(response.preview?.estimatedTime).toBe('< 2s');

    // Verify file was NOT moved
    const sourceExists = await readFile(sourcePath, 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(sourceExists).toBe(true);
  });

  it('should return error when source file does not exist', async () => {
    // Act
    const response = await operation!.execute({
      sourcePath: '/nonexistent/file.ts',
      destinationPath: join(testDir, 'src', 'new', 'file.ts'),
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

    await writeFile(
      absoluteSourcePath,
      `export function relHelper() {
  return 42;
}`,
      'utf-8',
    );

    await writeFile(
      mainPath,
      `import { relHelper } from './rel-service.js';

const result = relHelper();
console.error(result);`,
      'utf-8',
    );

    const relativeSourcePath = absoluteSourcePath.replace(
      `${process.cwd()}/`,
      '',
    );
    const relativeDestPath = absoluteDestPath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      sourcePath: relativeSourcePath,
      destinationPath: relativeDestPath,
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

    await writeFile(
      absoluteSourcePath,
      `export function absHelper() {
  return 42;
}`,
      'utf-8',
    );

    await writeFile(
      mainPath,
      `import { absHelper } from './abs-service.js';

const result = absHelper();
console.error(result);`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      sourcePath: absoluteSourcePath,
      destinationPath: absoluteDestPath,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Refactored module successfully');

    const movedContent = await readFile(absoluteDestPath, 'utf-8');
    expect(movedContent).toContain('absHelper');

    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('absHelper');
  });

  it('should organize the moved module and report it at its destination', async () => {
    // Arrange - the move rewrites both of a.ts's own imports, and `z` is unused
    const sourcePath = join(testDir, 'src', 'a.ts');
    const destPath = join(testDir, 'src', 'lib', 'a.ts');

    await writeFile(
      join(testDir, 'src', 'z.ts'),
      'export const z = 26;\n',
      'utf-8',
    );
    await writeFile(
      join(testDir, 'src', 'c.ts'),
      'export const c = 3;\n',
      'utf-8',
    );
    await writeFile(
      sourcePath,
      `import { z } from './z.js';\nimport { c } from './c.js';\n\nexport const a = c + 1;\n`,
      'utf-8',
    );
    await writeFile(
      join(testDir, 'src', 'b.ts'),
      `import { a } from './a.js';\n\nexport const b = a;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);

    const movedContent = await readFile(destPath, 'utf-8');
    expect(movedContent).toContain(`import { c } from '../c.js';`);
    expect(movedContent).not.toContain('z.js');

    const changedPaths = response.filesChanged.map((c) => c.path);
    expect(changedPaths).toContain(destPath);
    expect(changedPaths).not.toContain(sourcePath);
  });

  it('should organize the moved module when the move edits nothing inside it', async () => {
    // Arrange - both imports resolve the same from either folder, and nothing
    // imports the module, so the move itself edits no file at all
    const sourcePath = join(testDir, 'src', 'features', 'a.ts');
    const destPath = join(testDir, 'src', 'shared', 'a.ts');

    await mkdir(join(testDir, 'src', 'features'), { recursive: true });
    await writeFile(
      join(testDir, 'src', 'z.ts'),
      'export const z = 26;\n',
      'utf-8',
    );
    await writeFile(
      join(testDir, 'src', 'c.ts'),
      'export const c = 3;\n',
      'utf-8',
    );
    await writeFile(
      sourcePath,
      `import { z } from '../z.js';\nimport { c } from '../c.js';\n\nexport const a = c + 1;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);

    const movedContent = await readFile(destPath, 'utf-8');
    expect(movedContent).toContain(`import { c } from '../c.js';`);
    expect(movedContent).not.toContain('z.js');
    expect(response.filesChanged.map((c) => c.path)).toContain(destPath);
  });

  it('should fix errors in the moved module at its destination', async () => {
    // Arrange - a.ts uses `c` without importing it
    const sourcePath = join(testDir, 'src', 'a.ts');
    const destPath = join(testDir, 'src', 'lib', 'a.ts');

    await writeFile(
      join(testDir, 'src', 'c.ts'),
      'export const c = 3;\n',
      'utf-8',
    );
    await writeFile(sourcePath, 'export const a = c + 1;\n', 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(destPath, 'utf-8')).toContain('../c.js');
  });
});
