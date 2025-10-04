import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FindReferencesOperation } from '../find-references.js';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: FindReferencesOperation | null = null;

describe('findReferences', () => {
  beforeAll(async () => {
    // Arrange
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

    // Act
    testServer = new TypeScriptServer();
    operation = new FindReferencesOperation(testServer);
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

  it('should find all references to a function across files', async () => {
    // Arrange
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(utilsPath, 'export function helper() { return 42; }', 'utf-8');
    await writeFile(mainPath, `import { helper } from './utils.js';
const result = helper();
const another = helper();`, 'utf-8');

    if (testServer) {
      await testServer.openFile(utilsPath);
      await testServer.openFile(mainPath);
    }

    // Act - find references to 'helper' function
    const response = await operation!.execute({
      filePath: utilsPath,
      line: 1,
      column: 17  // on "helper"
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found');
    expect(response.message).toContain('reference');
    expect(response.message).toContain('helper');
  });

  it('should find references within a single file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'math.ts');
    await writeFile(filePath, `function calculateSum(a: number, b: number): number {
  return a + b;
}

const result = calculateSum(1, 2);
const another = calculateSum(3, 4);`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - find references to 'calculateSum'
    const response = await operation!.execute({
      filePath,
      line: 1,
      column: 10  // on "calculateSum"
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found');
    expect(response.message).toContain('reference');
  });

  it('should find references including declaration', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    await writeFile(filePath, 'function unused() { return 42; }', 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - find references to unused function (just the declaration)
    const response = await operation!.execute({
      filePath,
      line: 1,
      column: 10
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 1 reference');
    expect(response.message).toContain('unused.ts');
  });
});
