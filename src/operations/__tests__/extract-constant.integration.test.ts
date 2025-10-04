import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ExtractConstantOperation } from '../extract-constant.js';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: ExtractConstantOperation | null = null;

describe('extractConstant', () => {
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
    operation = new ExtractConstantOperation(testServer);
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

  it('should extract literal number to constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'math.ts');
    await writeFile(filePath, `export function calculateArea(radius: number) {
  const area = 3.14159 * radius * radius;
  return area;
}`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

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

    if (testServer) {
      await testServer.openFile(filePath);
    }

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

    if (testServer) {
      await testServer.openFile(filePath);
    }

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

  it('should return error when selection is not extractable', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'invalid.ts');
    await writeFile(filePath, `const x = 1;`, 'utf-8');

    if (testServer) {
      await testServer.openFile(filePath);
    }

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
    expect(response.message).toContain('❌ Cannot extract constant');
  });
});
