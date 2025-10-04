import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RemoveUnusedOperation } from '../../../operations/remove-unused.js';
import { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RemoveUnusedOperation | null = null;

describe('removeUnused', () => {
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
    operation = new RemoveUnusedOperation(testServer);
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
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed unused code');
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
  });
});
