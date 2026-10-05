import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { FindReferencesOperation } from '../find-references.js';
import { createFindReferencesOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: FindReferencesOperation | null = null;

describe('findReferences', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createFindReferencesOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should find all references to a function across files', async () => {
    // Arrange
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(
      utilsPath,
      'export function helper() { return 42; }',
      'utf-8',
    );
    await writeFile(
      mainPath,
      `import { helper } from './utils.js';
const result = helper();
const another = helper();`,
      'utf-8',
    );

    // Act - find references to 'helper' function
    const response = await operation!.execute({
      filePath: utilsPath,
      line: 1,
      text: 'helper',
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
    await writeFile(
      filePath,
      `function calculateSum(a: number, b: number): number {
  return a + b;
}

const result = calculateSum(1, 2);
const another = calculateSum(3, 4);`,
      'utf-8',
    );

    // Act - find references to 'calculateSum'
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'calculateSum',
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
      text: 'unused',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 1 reference');
    expect(response.message).toContain(`\n${filePath}:\n`);
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(
      absolutePath,
      `export function testFunc() {
  return 42;
}`,
      'utf-8',
    );

    const relativePath = absolutePath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 1,
      text: 'testFunc',
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(
      absolutePath,
      `export function testFunc() {
  return 42;
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 1,
      text: 'testFunc',
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should find all references across multiple importing files', async () => {
    // Arrange - Create 3 files: utils.ts exports add(), fileA.ts and fileB.ts both use it
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const fileAPath = join(testDir, 'src', 'fileA.ts');
    const fileBPath = join(testDir, 'src', 'fileB.ts');

    await writeFile(
      utilsPath,
      'export function add(a: number, b: number) { return a + b; }',
      'utf-8',
    );
    await writeFile(
      fileAPath,
      `import { add } from './utils.js';
const result = add(1, 2);`,
      'utf-8',
    );
    await writeFile(
      fileBPath,
      `import { add } from './utils.js';
const total = add(3, 4);`,
      'utf-8',
    );

    // Act - Call find-references from fileA (NOT from the declaration in utils.ts)
    const response = await operation!.execute({
      filePath: fileAPath,
      line: 2,
      text: 'add',
    });

    // Assert - Should find ALL 5 references:
    // 1. Declaration in utils.ts
    // 2. Import in fileA.ts
    // 3. Usage in fileA.ts
    // 4. Import in fileB.ts
    // 5. Usage in fileB.ts
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 5 reference(s) in 3 file(s)');
    expect(response.message).toContain(`\n${utilsPath}:\n`);
    expect(response.message).toContain(`\n${fileAPath}:\n`);
    expect(response.message).toContain(`\n${fileBPath}:\n`);
  });

  it('should tell apart files that share a name', async () => {
    // Arrange - both consumers are index.ts, so a bare file name would print
    // two identical headers
    const configPath = join(testDir, 'src', 'config.ts');
    const usersPath = join(testDir, 'src', 'users', 'index.ts');
    const ordersPath = join(testDir, 'src', 'orders', 'index.ts');

    await mkdir(join(testDir, 'src', 'users'), { recursive: true });
    await mkdir(join(testDir, 'src', 'orders'), { recursive: true });
    await writeFile(configPath, 'export const LIMIT = 10;\n', 'utf-8');
    await writeFile(
      usersPath,
      `import { LIMIT } from '../config.js';\nexport const maxUsers = LIMIT;\n`,
      'utf-8',
    );
    await writeFile(
      ordersPath,
      `import { LIMIT } from '../config.js';\nexport const maxOrders = LIMIT * 2;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: configPath,
      line: 1,
      text: 'LIMIT',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Found 5 reference(s) in 3 file(s)');
    expect(response.message).toContain(`\n${usersPath}:\n`);
    expect(response.message).toContain(`\n${ordersPath}:\n`);
  });

  it('should explain the missing parameter instead of dumping raw Zod output', async () => {
    // Act
    const response = await operation!.execute({
      filePath: '/tmp/a.ts',
      line: 1,
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Invalid input');
    expect(response.message).not.toContain('invalid_type');
  });
});
