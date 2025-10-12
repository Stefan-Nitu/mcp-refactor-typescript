import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { ExtractConstantOperation } from '../extract-constant.js';
import { createExtractConstantOperation } from '../shared/operation-factory.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractConstantOperation | null = null;

describe('extractConstant', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createExtractConstantOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should extract literal number to constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'math.ts');
    await writeFile(filePath, `export function calculateArea(radius: number) {
  const area = 3.14159 * radius * radius;
  return area;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '3.14159'
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

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '"https://api.example.com/v1"'
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

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '3.14159',
      name: 'PI'
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

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '0.15',
      name: 'TAX_RATE'
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
      name: 'PI'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const PI = 3.14159');
    expect(content).toContain('PI * radius');
  });

  it('should extract multiple constants sequentially with correct custom names', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'multiple-extracts.ts');
    await writeFile(filePath, `function calculateTotal(quantity: number) {
  const price = quantity * 29.99;
  const tax = price * 0.15;
  return price + tax;
}`, 'utf-8');

    // Act - Extract first constant using text API
    const response1 = await operation!.execute({
      filePath,
      line: 2,
      text: '29.99',
      name: 'UNIT_PRICE'
    });

    // Assert first extraction succeeded
    expect(response1.success).toBe(true);
    let content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const UNIT_PRICE = 29.99');
    expect(content).toContain('quantity * UNIT_PRICE');

    // Act - Extract second constant using text API
    // Note: Line number shifted from 3 to 4 after first extraction added a line
    const response2 = await operation!.execute({
      filePath,
      line: 4,
      text: '0.15',
      name: 'TAX_RATE'
    });

    // Assert second extraction succeeded and both constants have correct names
    expect(response2.success).toBe(true);
    content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const UNIT_PRICE = 29.99');
    expect(content).toContain('const TAX_RATE = 0.15');
    expect(content).toContain('quantity * UNIT_PRICE');
    expect(content).toContain('price * TAX_RATE');
    expect(content).not.toContain('newLocal');
  });

  it('should include final renamed constant name in JSON response', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'json-response.ts');
    await writeFile(filePath, `function calculateArea(radius: number) {
  return 3.14159 * radius * radius;
}`, 'utf-8');

    // Act - extract with custom constant name
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '3.14159',
      name: 'PI'
    });

    // Assert - filesChanged should reflect the final state after rename
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);

    // Find the edit that replaces the extracted code with the constant reference
    const callSiteEdit = response.filesChanged![0].edits.find(
      edit => edit.old === '3.14159'
    );

    expect(callSiteEdit).toBeDefined();
    // Should show the custom name, not the generated name
    expect(callSiteEdit!.new).toContain('PI');
    expect(callSiteEdit!.new).not.toContain('newLocal');
  });

  it('should return error when selection is not extractable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'invalid.ts');
    await writeFile(filePath, `const x = 1;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'x'
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Cannot extract constant');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function calc() {
  return 42;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 2,
      text: '42'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(absolutePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*42/);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function calc() {
  return 99;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 2,
      text: '99'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(absolutePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*99/);
  });
});
