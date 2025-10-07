import { writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RemoveUnusedOperation } from '../remove-unused.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RemoveUnusedOperation | null = null;

describe('removeUnused', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new RemoveUnusedOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should handle remove unused successfully', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `const x = 42;
const y = 100;
console.error(x);
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    console.log('Response:', JSON.stringify(response, null, 2));
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed');

    // Verify unused variable was actually removed
    const { readFile: read } = await import('fs/promises');
    const content = await read(filePath, 'utf-8');
    expect(content).not.toContain('const y');
    expect(content).toContain('const x = 42');
    expect(content).toContain('console.error(x)');
  });

  it('should report when no unused code found', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'clean.ts');
    const code = `export const value = 42;\n`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should handle file with unused imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'imports.ts');
    const code = `import { readFile, writeFile } from 'fs/promises';

export const value = 42;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);

    // Verify imports were actually removed
    const { readFile: read } = await import('fs/promises');
    const content = await read(filePath, 'utf-8');
    expect(content).not.toContain('readFile');
    expect(content).not.toContain('writeFile');
    expect(content).toContain('export const value = 42');
  });
});
