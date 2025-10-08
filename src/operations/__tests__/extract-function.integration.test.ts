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

    // Act
    const response = await operation!.execute({
      filePath,
      line: 4,
      text: 'const result = x + y;',
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

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: 'const x = 1 + 2;',
      functionName: 'addNumbers'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('function addNumbers');
    expect(content).toContain('addNumbers()');
  });

  it('should extract multiple functions with correct custom names', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'multi-funcs.ts');
    await writeFile(filePath, `function process(x: number, y: number) {
  const sum = x + y;
  const diff = x - y;
  return sum * diff;
}`, 'utf-8');

    // Act - Extract first function
    const response1 = await operation!.execute({
      filePath,
      line: 2,
      text: 'x + y',
      functionName: 'addNums'
    });

    // Assert first extraction
    expect(response1.success).toBe(true);
    let content = await readFile(filePath, 'utf-8');
    expect(content).toContain('function addNums');
    expect(content).toContain('addNums(x, y)');

    // Act - Extract second function (line shifts after first extraction)
    const response2 = await operation!.execute({
      filePath,
      line: 3,
      text: 'x - y',
      functionName: 'subtractNums'
    });

    // Assert both functions have correct names
    expect(response2.success).toBe(true);
    content = await readFile(filePath, 'utf-8');
    expect(content).toContain('function addNums');
    expect(content).toContain('function subtractNums');
    expect(content).toContain('const sum = addNums(x, y)');
    expect(content).toContain('const diff = subtractNums(x, y)');
    expect(content).not.toContain('newFunction');
  });

  it('should include final renamed function name in JSON response', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'json-response.ts');
    const code = `function process(x: number, y: number) {
  const sum = x + y;
  const diff = x - y;
  return sum * diff;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act - extract with custom function name using text-based API
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: 'x + y',
      functionName: 'addNumbers'
    });

    // Assert - filesChanged should reflect the final state after rename
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);

    // Find the edit that replaces the extracted code with the function call
    const callSiteEdit = response.filesChanged![0].edits.find(
      edit => edit.old === 'x + y'
    );

    expect(callSiteEdit).toBeDefined();
    // Should show the custom name, not the generated name
    expect(callSiteEdit!.new).toContain('addNumbers');
    expect(callSiteEdit!.new).not.toContain('newFunction');
  });

  it('should rename function correctly even when line numbers shift', async () => {
    // Arrange - extract a large block that will cause line number shifts
    const filePath = join(testDir, 'src', 'line-shift.ts');
    const code = `export function calculateTotal(items: any[], customerType: string) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.price * item.quantity;
  }

  let discount = 0;
  if (customerType === 'premium') {
    discount = subtotal * 0.15;
  } else if (customerType === 'gold') {
    discount = subtotal * 0.25;
  }

  return subtotal - discount;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act - extract the discount calculation expression with custom name
    const response = await operation!.execute({
      filePath,
      line: 9,
      text: 'subtotal * 0.15',
      functionName: 'calculatePremiumDiscount'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');

    // Function should have the custom name, NOT "newFunction"
    expect(content).toContain('function calculatePremiumDiscount');
    expect(content).not.toContain('function newFunction');

    // Call site should use the custom name
    expect(content).toMatch(/calculatePremiumDiscount\(/);
  });

  it('should handle when extraction is not possible', async () => {
    // Arrange - code that can't be extracted
    const filePath = join(testDir, 'src', 'noextract.ts');
    const code = `const x = 42;`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'const',
      functionName: 'extracted'
    });

    // Assert - should fail gracefully
    expect(response.success).toBe(false);
    expect(response.message).toContain('Cannot extract function');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function main() {
  const result = 1 + 2;
  return result;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 2,
      text: '1 + 2'
    });

    // Assert - May not be available, but should not crash with "undefined"
    expect(response.message).not.toContain('undefined');
    expect(response).toBeDefined();
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function main() {
  const result = 3 + 4;
  return result;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 2,
      text: '3 + 4'
    });

    // Assert - May not be available, but should not crash with "undefined"
    expect(response.message).not.toContain('undefined');
    expect(response).toBeDefined();
  });
});
