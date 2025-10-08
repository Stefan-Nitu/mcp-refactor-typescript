import { writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { FindReferencesOperation } from '../find-references.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: FindReferencesOperation | null = null;

describe('findReferences', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new FindReferencesOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should find all references to a function across files', async () => {
    // Arrange
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(utilsPath, 'export function helper() { return 42; }', 'utf-8');
    await writeFile(mainPath, `import { helper } from './utils.js';
const result = helper();
const another = helper();`, 'utf-8');

    // Act - find references to 'helper' function
    const response = await operation!.execute({
      filePath: utilsPath,
      line: 1,
      text: 'helper'
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

    // Act - find references to 'calculateSum'
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'calculateSum'
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

    // Act - find references to unused function (just the declaration)
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'unused'
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 1 reference');
    expect(response.message).toContain('unused.ts');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function testFunc() {
  return 42;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 1,
      text: 'testFunc'
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function testFunc() {
  return 42;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 1,
      text: 'testFunc'
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should find all references across multiple importing files', async () => {
    // Arrange - Create 3 files: utils.ts exports add(), fileA.ts and fileB.ts both use it
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const fileAPath = join(testDir, 'src', 'fileA.ts');
    const fileBPath = join(testDir, 'src', 'fileB.ts');

    await writeFile(utilsPath, 'export function add(a: number, b: number) { return a + b; }', 'utf-8');
    await writeFile(fileAPath, `import { add } from './utils.js';
const result = add(1, 2);`, 'utf-8');
    await writeFile(fileBPath, `import { add } from './utils.js';
const total = add(3, 4);`, 'utf-8');

    // Act - Call find-references from fileA (NOT from the declaration in utils.ts)
    const response = await operation!.execute({
      filePath: fileAPath,
      line: 2,
      text: 'add'
    });

    // Assert - Should find ALL 5 references:
    // 1. Declaration in utils.ts
    // 2. Import in fileA.ts
    // 3. Usage in fileA.ts
    // 4. Import in fileB.ts
    // 5. Usage in fileB.ts
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 5 reference(s) in 3 file(s)');
    expect(response.message).toContain('utils.ts');
    expect(response.message).toContain('fileA.ts');
    expect(response.message).toContain('fileB.ts');
  });
});
