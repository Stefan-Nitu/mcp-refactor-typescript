import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { OrganizeImportsOperation } from '../organize-imports.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: OrganizeImportsOperation | null = null;

describe('organizeImports', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new OrganizeImportsOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should organize and sort imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'messy.ts');
    const messyCode = `import { z } from 'unused';
import { c, a, b } from '../utils.js';
import { readFile } from 'fs/promises';

console.error(a, b, c);
`;

    await writeFile(filePath, messyCode, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    if (!response.success) {
      console.error('[TEST] Organize imports failed:', response.message);
    }
    expect(response.success).toBe(true);
    expect(response.filesChanged.length).toBeGreaterThan(0);
    expect(response.filesChanged[0].path).toBe(filePath);
    expect(response.filesChanged[0].edits.length).toBeGreaterThan(0);

    // Check that file was modified
    const organized = await readFile(filePath, 'utf-8');
    expect(organized).toContain('utils.js');
  });

  it('should organize imports even when none are used', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `import { readFile } from 'fs/promises';
import { something } from '../helpers.js';

console.error('hello');
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBe('Organized imports');
  });
});
