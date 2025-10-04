import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { InlineVariableOperation } from '../inline-variable.js';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: InlineVariableOperation | null = null;

describe('inlineVariable', () => {
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
    operation = new InlineVariableOperation(testServer);
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

  it('should inline a simple variable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'simple.ts');
    await writeFile(filePath, `function calculate() {
  const multiplier = 2;
  return 5 * multiplier;
}`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - Select the variable name "multiplier" on its declaration
    const response = await operation!.execute({
      filePath,
      line: 2,
      column: 9
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).not.toContain('const multiplier');
    expect(content).toContain('5 * 2');
  });

  it('should inline variable used multiple times', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'multiple.ts');
    await writeFile(filePath, `function area(radius: number) {
  const pi = 3.14;
  return pi * radius * radius;
}`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - Select "pi"
    const response = await operation!.execute({
      filePath,
      line: 2,
      column: 9
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).not.toContain('const pi');
    expect(content).toContain('3.14 * radius');
  });

  it('should return error when variable cannot be inlined', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'invalid.ts');
    await writeFile(filePath, `function test() {
  const x = getValue();
  console.log(x);
  return x + 1;
}

function getValue() {
  return Math.random();
}`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

    // Act - Try to inline function call that has side effects
    const response = await operation!.execute({
      filePath,
      line: 2,
      column: 9
    });

    // Assert
    if (response.success) {
      const content = await readFile(filePath, 'utf-8');
      expect(content).not.toContain('const x = getValue()');
    } else {
      expect(response.message).toContain('not available');
    }
  });
});
