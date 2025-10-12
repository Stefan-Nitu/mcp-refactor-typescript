import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { BatchMoveFilesOperation } from '../batch-move-files.js';
import { createBatchMoveFilesOperation } from '../shared/operation-factory.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: BatchMoveFilesOperation | null = null;

describe('batchMoveFiles', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createBatchMoveFilesOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should move multiple files to a folder and update imports', async () => {
    // Arrange
    const file1 = join(testDir, 'src', 'utils.ts');
    const file2 = join(testDir, 'src', 'helpers.ts');
    const file3 = join(testDir, 'src', 'main.ts');
    const targetFolder = join(testDir, 'src', 'lib');

    await writeFile(file1, 'export function util() { return 1; }', 'utf-8');
    await writeFile(file2, 'export function helper() { return 2; }', 'utf-8');
    await writeFile(file3, `import { util } from './utils.js';
import { helper } from './helpers.js';
console.error(util(), helper());`, 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [file1, file2],
      targetFolder
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Moved 2 file(s)');

    // Check files were moved
    expect(existsSync(join(targetFolder, 'utils.ts'))).toBe(true);
    expect(existsSync(join(targetFolder, 'helpers.ts'))).toBe(true);
    expect(existsSync(file1)).toBe(false);
    expect(existsSync(file2)).toBe(false);

    // Check imports were updated
    const mainContent = await readFile(file3, 'utf-8');
    expect(mainContent).toContain('./lib/utils.js');
    expect(mainContent).toContain('./lib/helpers.js');
  });

  it('should handle moving single file to new folder', async () => {
    // Arrange
    const file1 = join(testDir, 'src', 'component.ts');
    const targetFolder = join(testDir, 'src', 'components');

    await writeFile(file1, 'export const Component = () => <div>Hello</div>;', 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [file1],
      targetFolder
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(join(targetFolder, 'component.ts'))).toBe(true);
    expect(existsSync(file1)).toBe(false);
  });

  it('should handle moving files to nested folder', async () => {
    // Arrange
    const file1 = join(testDir, 'src', 'model.ts');
    const file2 = join(testDir, 'src', 'index.ts');
    const targetFolder = join(testDir, 'src', 'models', 'user');

    await writeFile(file1, 'export interface User { name: string; }', 'utf-8');
    await writeFile(file2, `import { User } from './model.js';\nexport { User };`, 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [file1],
      targetFolder
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(join(targetFolder, 'model.ts'))).toBe(true);

    const indexContent = await readFile(file2, 'utf-8');
    expect(indexContent).toContain('./models/user/model.js');
  });

  it('should handle moving many files efficiently', async () => {
    // Arrange - Create 20 files and 1 index file that imports from all of them
    const files: string[] = [];
    const imports: string[] = [];

    for (let i = 1; i <= 20; i++) {
      const filePath = join(testDir, 'src', `module${i}.ts`);
      files.push(filePath);
      await writeFile(filePath, `export const value${i} = ${i};`, 'utf-8');
      imports.push(`import { value${i} } from './module${i}.js';`);
    }

    const indexPath = join(testDir, 'src', 'index.ts');
    await writeFile(indexPath, imports.join('\n'), 'utf-8');

    const targetFolder = join(testDir, 'src', 'lib');

    // Act
    const startTime = Date.now();
    const response = await operation!.execute({
      files,
      targetFolder
    });
    const duration = Date.now() - startTime;

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged.length).toBeGreaterThan(0);

    // Should complete in reasonable time (not 20 seconds if waiting 1s per file)
    expect(duration).toBeLessThan(10000); // 10 seconds max

    // Verify imports were updated
    const indexContent = await readFile(indexPath, 'utf-8');
    expect(indexContent).toContain('./lib/module1.js');
    expect(indexContent).toContain('./lib/module20.js');
  });

  it('should return error when target folder is not provided', async () => {
    // Act
    const response = await operation!.execute({
      files: ['file.ts']
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Invalid input');
  });

  it('should return error when files array is empty', async () => {
    // Act
    const response = await operation!.execute({
      files: [],
      targetFolder: '/some/folder'
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('At least one file must be provided');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absoluteFile1 = join(testDir, 'src', 'rel-util1.ts');
    const absoluteFile2 = join(testDir, 'src', 'rel-util2.ts');
    const absoluteTarget = join(testDir, 'src', 'rel-lib');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(absoluteFile1, 'export function relUtil1() { return 1; }', 'utf-8');
    await writeFile(absoluteFile2, 'export function relUtil2() { return 2; }', 'utf-8');
    await writeFile(mainPath, `import { relUtil1 } from './rel-util1.js';
import { relUtil2 } from './rel-util2.js';
console.error(relUtil1(), relUtil2());`, 'utf-8');

    const relativeFile1 = absoluteFile1.replace(process.cwd() + '/', '');
    const relativeFile2 = absoluteFile2.replace(process.cwd() + '/', '');
    const relativeTarget = absoluteTarget.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      files: [relativeFile1, relativeFile2],
      targetFolder: relativeTarget
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(join(absoluteTarget, 'rel-util1.ts'))).toBe(true);
    expect(existsSync(join(absoluteTarget, 'rel-util2.ts'))).toBe(true);
    expect(existsSync(absoluteFile1)).toBe(false);
    expect(existsSync(absoluteFile2)).toBe(false);

    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('./rel-lib/rel-util1.js');
    expect(mainContent).toContain('./rel-lib/rel-util2.js');
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absoluteFile1 = join(testDir, 'src', 'abs-util1.ts');
    const absoluteFile2 = join(testDir, 'src', 'abs-util2.ts');
    const absoluteTarget = join(testDir, 'src', 'abs-lib');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(absoluteFile1, 'export function absUtil1() { return 1; }', 'utf-8');
    await writeFile(absoluteFile2, 'export function absUtil2() { return 2; }', 'utf-8');
    await writeFile(mainPath, `import { absUtil1 } from './abs-util1.js';
import { absUtil2 } from './abs-util2.js';
console.error(absUtil1(), absUtil2());`, 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [absoluteFile1, absoluteFile2],
      targetFolder: absoluteTarget
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(join(absoluteTarget, 'abs-util1.ts'))).toBe(true);
    expect(existsSync(join(absoluteTarget, 'abs-util2.ts'))).toBe(true);
    expect(existsSync(absoluteFile1)).toBe(false);
    expect(existsSync(absoluteFile2)).toBe(false);

    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('./abs-lib/abs-util1.js');
    expect(mainContent).toContain('./abs-lib/abs-util2.js');
  });

  it('should report all edits when multiple imports in same file are updated', async () => {
    // Arrange
    const file1 = join(testDir, 'src', 'api1.ts');
    const file2 = join(testDir, 'src', 'api2.ts');
    const consumerPath = join(testDir, 'src', 'consumer.ts');
    const targetFolder = join(testDir, 'src', 'apis');

    await writeFile(file1, 'export function api1() { return 1; }', 'utf-8');
    await writeFile(file2, 'export function api2() { return 2; }', 'utf-8');
    await writeFile(consumerPath, `import { api1 } from './api1.js';
import { api2 } from './api2.js';

export function useApis() {
  return api1() + api2();
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [file1, file2],
      targetFolder
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged.length).toBeGreaterThan(0);

    // Find the consumer file in filesChanged
    const consumerFileChange = response.filesChanged.find(f => f.path === consumerPath);
    expect(consumerFileChange).toBeDefined();

    // Should report BOTH edits (both import updates)
    expect(consumerFileChange?.edits.length).toBe(2);

    // Verify both imports were updated
    const consumerContent = await readFile(consumerPath, 'utf-8');
    expect(consumerContent).toContain('./apis/api1.js');
    expect(consumerContent).toContain('./apis/api2.js');
  });

  it('should update mock paths when batch moving files', async () => {
    // Arrange
    const service1Path = join(testDir, 'src', 'auth-service.ts');
    const service2Path = join(testDir, 'src', 'data-service.ts');
    const testPath = join(testDir, 'src', 'app.test.ts');
    const targetFolder = join(testDir, 'src', 'services');

    await writeFile(service1Path, 'export function authenticate() { return true; }', 'utf-8');
    await writeFile(service2Path, 'export function getData() { return []; }', 'utf-8');

    const testContent = `import { describe, it, expect, vi } from 'vitest';
import { authenticate } from './auth-service.js';
import { getData } from './data-service.js';

vi.mock('./auth-service.js');
vi.mock('./data-service.js');

describe('app', () => {
  it('should authenticate', () => {
    expect(authenticate()).toBe(true);
  });

  it('should get data', () => {
    expect(getData()).toEqual([]);
  });
});`;

    await writeFile(testPath, testContent, 'utf-8');

    // Act
    const response = await operation!.execute({
      files: [service1Path, service2Path],
      targetFolder
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(join(targetFolder, 'auth-service.ts'))).toBe(true);
    expect(existsSync(join(targetFolder, 'data-service.ts'))).toBe(true);

    const testFileContent = await readFile(testPath, 'utf-8');
    expect(testFileContent).toContain("import { authenticate } from './services/auth-service.js';");
    expect(testFileContent).toContain("import { getData } from './services/data-service.js';");
    expect(testFileContent).toContain("vi.mock('./services/auth-service.js');");
    expect(testFileContent).toContain("vi.mock('./services/data-service.js');");
    expect(testFileContent).not.toContain("vi.mock('./auth-service.js');");
    expect(testFileContent).not.toContain("vi.mock('./data-service.js');");
  });
});
