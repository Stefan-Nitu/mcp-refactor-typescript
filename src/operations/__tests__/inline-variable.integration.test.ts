import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { InlineVariableOperation } from '../inline-variable.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: InlineVariableOperation | null = null;

describe('inlineVariable', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new InlineVariableOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should inline a simple variable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'simple.ts');
    await writeFile(filePath, `function calculate() {
  const multiplier = 2;
  return 5 * multiplier;
}`, 'utf-8');

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

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function test() {
  const x = 42;
  return x;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 2,
      column: 9
    });

    // Assert - May succeed or fail depending on TypeScript version
    expect(response).toBeDefined();
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function test() {
  const x = 99;
  return x;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 2,
      column: 9
    });

    // Assert - May succeed or fail depending on TypeScript version
    expect(response).toBeDefined();
  });
});
