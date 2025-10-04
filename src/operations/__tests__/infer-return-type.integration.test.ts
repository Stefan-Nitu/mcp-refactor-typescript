import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { InferReturnTypeOperation } from '../infer-return-type.js';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: InferReturnTypeOperation | null = null;

describe('inferReturnType', () => {
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
    operation = new InferReturnTypeOperation(testServer);
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

  it('should infer return type for simple function', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'simple.ts');
    await writeFile(filePath, `function add(a: number, b: number) {
  return a + b;
}`, 'utf-8');

    // Act - Select function name
    const response = await operation!.execute({
      filePath,
      line: 1,
      column: 10
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/function add\(a: number, b: number\): number/);
  });

  it('should infer complex return type', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'complex.ts');
    await writeFile(filePath, `function getUser() {
  return {
    name: "John",
    age: 30,
    active: true
  };
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      column: 10
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain(': {');
    expect(content).toMatch(/name:|age:|active:/);
  });

  it('should return error when already has return type', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'typed.ts');
    await writeFile(filePath, `function divide(a: number, b: number): number {
  return a / b;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      column: 10
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Cannot infer return type');
  });
});
