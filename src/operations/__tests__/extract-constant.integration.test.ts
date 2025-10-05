import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { ExtractConstantOperation } from '../extract-constant.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractConstantOperation | null = null;

describe('extractConstant', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new ExtractConstantOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should extract literal number to constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'math.ts');
    await writeFile(filePath, `export function calculateArea(radius: number) {
  const area = 3.14159 * radius * radius;
  return area;
}`, 'utf-8');

    // Act - Select just "3.14159"
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 16,
      endLine: 2,
      endColumn: 23
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*3\.14159/);
    expect(content).toContain('* radius * radius');
  });

  it('should extract string literal to constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'config.ts');
    await writeFile(filePath, `export function getApiUrl() {
  return "https://api.example.com/v1";
}`, 'utf-8');

    // Act - Select the string
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 10,
      endLine: 2,
      endColumn: 38
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*"https:\/\/api\.example\.com\/v1"/);
  });

  it('should extract with custom constant name', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'custom-name.ts');
    await writeFile(filePath, `export function calculateCircumference(radius: number) {
  const circumference = 2 * 3.14159 * radius;
  return circumference;
}`, 'utf-8');

    // Act - Extract "3.14159" with custom name "PI"
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 28,
      endLine: 2,
      endColumn: 35,
      constantName: 'PI'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const PI = 3.14159');
    expect(content).toContain('2 * PI * radius');
  });

  it('should preserve indentation when extracting constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'indentation.ts');
    await writeFile(filePath, `function calculatePrice(quantity: number) {
  const tax = quantity * 0.15;
  return tax;
}`, 'utf-8');

    // Act - Extract "0.15" as TAX_RATE
    // Line: "  const tax = quantity * 0.15;"
    // Column 26 is start of "0.15", column 30 is end
    const response = await operation!.execute({
      filePath,
      startLine: 2,
      startColumn: 26,
      endLine: 2,
      endColumn: 30,
      constantName: 'TAX_RATE'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the constant declaration line
    const constantLine = lines.find(l => l.includes('TAX_RATE'));
    expect(constantLine).toBeDefined();

    // Verify it has same indentation as other lines (2 spaces)
    const taxLine = lines.find(l => l.includes('const tax'));
    expect(taxLine).toBeDefined();

    const constantIndent = constantLine!.match(/^(\s*)/)?.[1].length || 0;
    const taxIndent = taxLine!.match(/^(\s*)/)?.[1].length || 0;

    expect(constantIndent).toBe(taxIndent);
  });

  it('should extract using text parameter (simplified API)', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'simplified.ts');
    await writeFile(filePath, `function calculateArea(radius: number) {
  return 3.14159 * radius * radius;
}`, 'utf-8');

    // Act - Extract "3.14159" using just line and text
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '3.14159',
      constantName: 'PI'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const PI = 3.14159');
    expect(content).toContain('PI * radius');
  });

  it('should return error when selection is not extractable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'invalid.ts');
    await writeFile(filePath, `const x = 1;`, 'utf-8');

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
    expect(response.message).toContain('Cannot extract constant');
  });
});
