import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OrganizeImportsOperation } from '../../../operations/organize-imports.js';
import { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: OrganizeImportsOperation | null = null;

describe('organizeImports', () => {
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
    operation = new OrganizeImportsOperation(testServer);
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
    expect(response.filesChanged).toContain(filePath);

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
