import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { BatchMoveFilesOperation } from '../batch-move-files.js';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: BatchMoveFilesOperation | null = null;

describe('batchMoveFiles', () => {
  beforeAll(async () => {
    // Arrange - Create test workspace
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src'), { recursive: true });

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext"
      }
    };
    await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

    // Act - Initialize server
    testServer = new TypeScriptServer();
    operation = new BatchMoveFilesOperation(testServer);
    await testServer.start(testDir);
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.stop();
      testServer = null;
    }
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(testDir, 'src'), { recursive: true, force: true }).catch(() => {});
    await mkdir(join(testDir, 'src'), { recursive: true });
  });

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
});
