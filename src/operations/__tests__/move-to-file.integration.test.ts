import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { MoveToFileOperation } from '../move-to-file.js';
import { createMoveToFileOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: MoveToFileOperation | null = null;

describe('moveToFile', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createMoveToFileOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should move exported function to a new file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'utils.ts');
    const code = `export function greet(name: string) {
  return \`Hello, \${name}!\`;
}

export function farewell(name: string) {
  return \`Goodbye, \${name}!\`;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'greet',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);
  });

  it('should move exported interface to a new file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'types.ts');
    const code = `export interface User {
  name: string;
  age: number;
}

export interface Product {
  id: string;
  price: number;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'User',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);
  });

  it('should move function to a specific target file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'source.ts');
    const destPath = join(testDir, 'src', 'target.ts');
    const code = `export function helper() {
  return 42;
}

export function main() {
  return helper();
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'helper',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);

    const sourceContent = await readFile(filePath, 'utf-8');
    expect(sourceContent).not.toContain('function helper');

    const targetContent = await readFile(destPath, 'utf-8');
    expect(targetContent).toContain('function helper');
  });

  it('should move to specific destination and update source', async () => {
    // Arrange
    const libPath = join(testDir, 'src', 'lib.ts');
    const destPath = join(testDir, 'src', 'moved.ts');

    await writeFile(
      libPath,
      `export function compute(x: number) {
  return x * 2;
}

export function transform(x: number) {
  return x + 1;
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: libPath,
      line: 1,
      text: 'compute',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged!.length).toBeGreaterThanOrEqual(2);

    const sourceContent = await readFile(libPath, 'utf-8');
    expect(sourceContent).not.toContain('function compute');
    expect(sourceContent).toContain('function transform');

    const destContent = await readFile(destPath, 'utf-8');
    expect(destContent).toContain('function compute');
  });

  it('should return error when text is not found', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'nomove.ts');
    const code = `export function outer() {
  const x = 42;
  return x;
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'nonExistentSymbol',
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('not found');
  });

  it('should support preview mode', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'preview.ts');
    const code = `export function previewFunc() {
  return 'preview';
}

export function otherFunc() {
  return 'other';
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'previewFunc',
      preview: true,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview');
    expect(response.preview).toBeDefined();
    expect(response.preview!.filesAffected).toBeGreaterThan(0);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('export function previewFunc');
  });

  it('should move exported type alias to a new file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'typealias.ts');
    const code = `export type Result<T> = {
  success: boolean;
  data: T;
};

export function wrap<T>(data: T): Result<T> {
  return { success: true, data };
}`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'Result',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(
      absolutePath,
      `export function relFunc() {
  return 'rel';
}

export function otherRelFunc() {
  return 'other';
}`,
      'utf-8',
    );

    const relativePath = absolutePath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
      line: 1,
      text: 'relFunc',
    });

    // Assert
    expect(response.message).not.toContain('undefined');
    expect(response).toBeDefined();
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(
      absolutePath,
      `export function absFunc() {
  return 'abs';
}

export function otherAbsFunc() {
  return 'other';
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
      line: 1,
      text: 'absFunc',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged!.length).toBeGreaterThan(0);
  });

  it('should include edit details in JSON response', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'json-detail.ts');
    const destPath = join(testDir, 'src', 'json-dest.ts');
    await writeFile(
      filePath,
      `export function detailFunc() {
  return 'detail';
}

export function keepFunc() {
  return 'keep';
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath,
      line: 1,
      text: 'detailFunc',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged!.length).toBeGreaterThanOrEqual(2);

    const destFileChange = response.filesChanged!.find(
      (fc) => fc.path === destPath,
    );
    expect(destFileChange).toBeDefined();
    expect(destFileChange!.edits.length).toBeGreaterThan(0);

    const sourceFileChange = response.filesChanged!.find(
      (fc) => fc.path === filePath,
    );
    expect(sourceFileChange).toBeDefined();
    expect(sourceFileChange!.edits.length).toBeGreaterThan(0);
  });

  it('should handle only the selected symbol in a multi-export file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'multi.ts');
    const destPath = join(testDir, 'src', 'single.ts');
    const code = `export function alpha() { return 'a'; }

export function beta() { return 'b'; }

export function gamma() { return 'c'; }`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath,
      line: 3,
      text: 'beta',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);

    const sourceContent = await readFile(filePath, 'utf-8');
    expect(sourceContent).toContain('alpha');
    expect(sourceContent).toContain('gamma');
    expect(sourceContent).not.toContain('function beta');

    const targetContent = await readFile(destPath, 'utf-8');
    expect(targetContent).toContain('function beta');
  });
});
