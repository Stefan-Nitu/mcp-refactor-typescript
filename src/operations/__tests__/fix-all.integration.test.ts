import { writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { FixAllOperation } from '../fix-all.js';
import { createFixAllOperation } from '../shared/operation-factory.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

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

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath
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
      filePath: absolutePath
    });

    // Assert
    expect(response.success).toBe(true);
  });
});
