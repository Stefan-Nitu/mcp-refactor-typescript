import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { ExtractFunctionOperation } from '../extract-function.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractFunctionOperation | null = null;

describe('extractFunction', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new ExtractFunctionOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should extract selected code into a function', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'calc.ts');
    const code = `function calculate() {
  const x = 10;
  const y = 20;
  const result = x + y;
  return result;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act - extract line 4 (const result = x + y;)
    const response = await operation!.execute({
      filePath,
      startLine: 4,
      startColumn: 3,
      endLine: 4,
      endColumn: 23,
      functionName: 'addNumbers'
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBe('Extracted function');
  });

  it('should extract with custom function name', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'customname.ts');
    const code = `function main() {
  const x = 1 + 2;
  console.log(x);
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act - extract line 2 with custom name
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 3,
      endLine: 2,
      endColumn: 19,
      functionName: 'addNumbers'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('function addNumbers');
    expect(content).toContain('addNumbers()');
  });

  it('should handle when extraction is not possible', async () => {
    // Arrange - code that can't be extracted
    const filePath = join(testDir, 'src', 'noextract.ts');
    const code = `const x = 42;`;

    await writeFile(filePath, code, 'utf-8');

    // Act - try to extract part of const declaration
    const response = await operation!.execute({
      filePath,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
      functionName: 'extracted'
    });

    // Assert - should fail gracefully
    expect(response.success).toBe(false);
    expect(response.message).toContain('Cannot extract function');
  });
});
