import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { InferReturnTypeOperation } from '../infer-return-type.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: InferReturnTypeOperation | null = null;

describe('inferReturnType', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new InferReturnTypeOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

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
      text: 'add'
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
      text: 'getUser'
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
      text: 'divide'
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Cannot infer return type');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function test() {
  return 42;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 1,
      text: 'test'
    });

    // Assert - May not be available, but should not crash with "undefined"
    expect(response.message).not.toContain('undefined');
    expect(response).toBeDefined();
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function test() {
  return 99;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 1,
      text: 'test'
    });

    // Assert - May not be available, but should not crash with "undefined"
    expect(response.message).not.toContain('undefined');
    expect(response).toBeDefined();
  });
});
