import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { ExtractVariableOperation } from '../extract-variable.js';
import { createExtractVariableOperation } from '../shared/operation-factory.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractVariableOperation | null = null;

describe('extractVariable', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createExtractVariableOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should extract expression to variable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'calc.ts');
    await writeFile(filePath, `export function calculate(a: number, b: number) {
  return (a + b) * 2;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '(a + b) * 2'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/const \w+\s*=\s*\(a \+ b\) \* 2/);
  });

  it('should extract with custom variable name', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'custom-name.ts');
    await writeFile(filePath, `export function calculate(a: number, b: number) {
  return (a + b) * 2;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: '(a + b) * 2',
      name: 'doubled'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const doubled = (a + b) * 2');
    expect(content).toContain('return doubled');
  });

  it('should extract multiple variables sequentially with correct custom names', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'multiple-vars.ts');
    await writeFile(filePath, `function calc(a: number, b: number) {
  return (a + b) * 2 + (a - b) * 3;
}`, 'utf-8');

    // Act - Extract first variable
    const response1 = await operation!.execute({
      filePath,
      line: 2,
      text: '(a + b) * 2',
      name: 'doubled'
    });

    // Assert first extraction
    expect(response1.success).toBe(true);
    let content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const doubled = (a + b) * 2');
    expect(content).toContain('doubled + ');

    // Act - Extract second variable (line shifts after first extraction)
    const response2 = await operation!.execute({
      filePath,
      line: 3,
      text: '(a - b) * 3',
      name: 'tripled'
    });

    // Assert both variables have correct names
    expect(response2.success).toBe(true);
    content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const doubled = (a + b) * 2');
    expect(content).toContain('const tripled = (a - b) * 3');
    expect(content).toContain('doubled + tripled');
    expect(content).not.toContain('newLocal');
  });

  it('should preserve indentation of extracted variable declaration', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'indentation.ts');
    await writeFile(filePath, `function calculate(basePrice: number, taxRate: number) {
  const subtotal = basePrice * 0.9;
  const tax = subtotal * taxRate;
  return subtotal + tax;
}`, 'utf-8');

    // Act - Extract "subtotal * taxRate" on line 3
    const response = await operation!.execute({
      filePath,
      line: 3,
      text: 'subtotal * taxRate',
      name: 'calculatedTax'
    });

    // Assert
    expect(response.success).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the line with the new const declaration
    const constLine = lines.find(l => l.includes('const calculatedTax'));
    expect(constLine).toBeDefined();

    // Should have same indentation as surrounding lines (2 spaces)
    const indentation = constLine!.match(/^(\s*)/)?.[1] || '';
    expect(indentation).toBe('  '); // 2 spaces
    expect(indentation.length).toBe(2);
  });

  it('should include final renamed variable name in JSON response', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'json-response.ts');
    await writeFile(filePath, `function process(x: number, y: number) {
  const sum = x + y;
  const diff = x - y;
  return sum * diff;
}`, 'utf-8');

    // Act - extract with custom variable name
    const response = await operation!.execute({
      filePath,
      line: 2,
      text: 'x + y',
      name: 'total'
    });

    // Assert - filesChanged should reflect the final state after rename
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);

    // Find the edit that replaces the extracted code with the variable reference
    const callSiteEdit = response.filesChanged![0].edits.find(
      edit => edit.old === 'x + y'
    );

    expect(callSiteEdit).toBeDefined();
    // Should show the custom name, not the generated name
    expect(callSiteEdit!.new).toContain('total');
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
    expect(response.message).toContain('Cannot extract variable');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export function main() {
  return (5 + 3) * 2;
}`, 'utf-8');

    const relativePath = absolutePath.replace(process.cwd() + '/', '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 2,
      text: '5 + 3'
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export function main() {
  return (7 + 2) * 2;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 2,
      text: '7 + 2'
    });

    // Assert
    expect(response.success).toBe(true);
  });
});
