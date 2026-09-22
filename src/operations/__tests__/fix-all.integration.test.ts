import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { FixAllOperation } from '../fix-all.js';
import { createFixAllOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: FixAllOperation | null = null;

describe('fixAll', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createFixAllOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should handle fix_all successfully', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'fixable.ts');
    const code = `const x = 42;
const y = x;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBeDefined();
  });

  it('should return success even when no fixes needed', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'perfect.ts');
    const code = `export const value = 42;\n`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('No fixes needed');
  });

  it('should handle file with unused imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `import { readFile, writeFile } from 'fs/promises';

export const value = 42;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export const x = 42;`, 'utf-8');

    const relativePath = absolutePath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export const x = 42;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should apply a fix that edits a different file', async () => {
    // Arrange - TS2459: the fix inserts `export ` into the declaring file,
    // and carries no fixId because it applies to this one occurrence only
    const consumerPath = join(testDir, 'src', 'consumer.ts');
    const declarerPath = join(testDir, 'src', 'declarer.ts');

    await writeFile(
      declarerPath,
      `const secretValue = 42;\nexport const other = 1;\n`,
      'utf-8',
    );
    await writeFile(
      consumerPath,
      `import { secretValue } from './declarer.js';\nexport const doubled = secretValue * 2;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({ filePath: consumerPath });

    // Assert
    expect(response.message).not.toContain('No auto-fixable errors found');
    expect(response.filesChanged.map((c) => c.path)).toContain(declarerPath);
    expect(await readFile(declarerPath, 'utf-8')).toContain(
      'export const secretValue',
    );
  });

  it('should leave every file untouched when previewing a cross-file fix', async () => {
    // Arrange
    const consumerPath = join(testDir, 'src', 'preview-consumer.ts');
    const declarerPath = join(testDir, 'src', 'preview-declarer.ts');
    const declarerSource = `const hidden = 7;\nexport const kept = 1;\n`;

    await writeFile(declarerPath, declarerSource, 'utf-8');
    await writeFile(
      consumerPath,
      `import { hidden } from './preview-declarer.js';\nexport const tripled = hidden * 3;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: consumerPath,
      preview: true,
    });

    // Assert
    expect(response.filesChanged.map((c) => c.path)).toContain(declarerPath);
    expect(await readFile(declarerPath, 'utf-8')).toBe(declarerSource);
  });

  it('should explain the missing parameter instead of dumping raw Zod output', async () => {
    // Act
    const response = await operation!.execute({});

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Invalid input');
    expect(response.message).not.toContain('invalid_type');
  });
});
