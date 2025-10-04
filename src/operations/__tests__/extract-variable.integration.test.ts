import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ExtractVariableOperation } from '../extract-variable.js';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractVariableOperation | null = null;

describe('extractVariable', () => {
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
    operation = new ExtractVariableOperation(testServer);
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

  it('should extract expression to variable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'calc.ts');
    await writeFile(filePath, `export function calculate(a: number, b: number) {
  return (a + b) * 2;
}`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - Select the expression "(a + b) * 2"
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 10,
      endLine: 2,
      endColumn: 21
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*\(a \+ b\) \* 2/);
  });

  it('should return error when selection is not extractable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'invalid.ts');
    await writeFile(filePath, `const x = 1;`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - Try to extract a variable name
    const response = await operation!.execute({
      filePath,
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 8
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('not available');
  });
});
