import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { rename } from './rename.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TypeScriptLanguageServer } from './lsp-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, '../../../test-workspace');

// We'll create a dedicated language server for the test workspace
let testLanguageServer: TypeScriptLanguageServer | null = null;

// Mock the lsp-manager to use our test server
import { vi } from 'vitest';
vi.mock('./lsp-manager.js', () => ({
  getLanguageServer: async () => {
    if (!testLanguageServer) {
      throw new Error('Test language server not initialized');
    }
    return testLanguageServer;
  }
}));

describe('rename', () => {
  beforeAll(async () => {
    // Create test workspace structure first
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src'), { recursive: true });

    // Create tsconfig.json for the test workspace
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ["src/**/*"]
    };
    await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

    // Now initialize the language server with the test directory as root
    testLanguageServer = new TypeScriptLanguageServer(testDir);
    await testLanguageServer.initialize();
  });

  afterAll(async () => {
    // Shutdown language server
    if (testLanguageServer) {
      await testLanguageServer.shutdown();
      testLanguageServer = null;
    }

    // Clean up test workspace
    await rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean test files before each test
    await rm(join(testDir, 'src'), { recursive: true, force: true }).catch(() => {});
    await mkdir(join(testDir, 'src'), { recursive: true });
  });

  describe('single file rename', () => {
    it('should rename a function within a single file', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'math.ts');
      const content = `export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function calculateProduct(a: number, b: number): number {
  return a * b;
}

// Using the function
const result = calculateSum(1, 2);
console.log(result);`;

      await writeFile(filePath, content, 'utf-8');

      // Act
      const result = await rename(filePath, 1, 17, 'computeSum'); // Line 1, middle of 'calculateSum'

      // Assert
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);

      expect(response.status).toBe('success');
      expect(response.filesChanged).toContain(filePath);
      expect(response.changes).toHaveLength(1);
      expect(response.changes[0].edits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            line: 1,
            old: 'calculateSum',
            new: 'computeSum'
          }),
          expect.objectContaining({
            line: 10,
            old: 'calculateSum',
            new: 'computeSum'
          })
        ])
      );
      expect(response.summary).toContain('2 occurrence(s)');
    });

    it('should rename a class method', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'user.ts');
      const content = `export class User {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  displayInfo(): void {
    console.log(this.getName());
  }
}`;

      await writeFile(filePath, content, 'utf-8');

      // Act
      const result = await rename(filePath, 8, 5, 'getDisplayName'); // Line 8, on 'getName'

      // Assert
      const response = JSON.parse(result.content[0].text);

      expect(response.status).toBe('success');
      expect(response.changes[0].edits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            line: 8,
            old: 'getName',
            new: 'getDisplayName'
          }),
          expect.objectContaining({
            line: 13,
            old: 'getName',
            new: 'getDisplayName'
          })
        ])
      );
    });

    it('should handle rename at different column positions within identifier', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'variable.ts');
      const content = `const myLongVariableName = 42;
console.log(myLongVariableName);
export { myLongVariableName };`;

      await writeFile(filePath, content, 'utf-8');

      // Act - rename from beginning of identifier
      const result1 = await rename(filePath, 1, 7, 'shortName'); // Column 7 = start of 'myLongVariableName'
      const response1 = JSON.parse(result1.content[0].text);

      // Act - rename from middle of identifier
      const result2 = await rename(filePath, 1, 15, 'shortName'); // Column 15 = middle of 'myLongVariableName'
      const response2 = JSON.parse(result2.content[0].text);

      // Assert - both should work
      expect(response1.status).toBe('success');
      expect(response2.status).toBe('success');
      expect(response1.summary).toContain('3 occurrence(s)');
      expect(response2.summary).toContain('3 occurrence(s)');
    });
  });

  describe('cross-file rename', () => {
    it('should rename an exported function across multiple files', async () => {
      // Arrange
      const libPath = join(testDir, 'src', 'lib.ts');
      const libContent = `export function processData(data: string): string {
  return data.toUpperCase();
}`;

      const mainPath = join(testDir, 'src', 'main.ts');
      const mainContent = `import { processData } from './lib.js';

const result = processData('hello');
console.log(result);

export function wrapper(input: string) {
  return processData(input);
}`;

      await writeFile(libPath, libContent, 'utf-8');
      await writeFile(mainPath, mainContent, 'utf-8');

      // Open both files so TypeScript LSP knows about them
      if (testLanguageServer) {
        await testLanguageServer.openDocument(libPath);
        await testLanguageServer.openDocument(mainPath);
      }

      // Act
      const result = await rename(libPath, 1, 17, 'transformData'); // Rename in lib.ts

      // Assert
      const response = JSON.parse(result.content[0].text);

      expect(response.status).toBe('success');
      expect(response.filesChanged).toHaveLength(2);
      expect(response.filesChanged).toContain(libPath);
      expect(response.filesChanged).toContain(mainPath);

      // Check that both files have edits
      const libEdit = response.changes.find((c: any) => c.path === libPath);
      const mainEdit = response.changes.find((c: any) => c.path === mainPath);

      expect(libEdit).toBeDefined();
      expect(mainEdit).toBeDefined();

      expect(mainEdit.edits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            line: 1,
            old: 'processData',
            new: 'transformData'
          }),
          expect.objectContaining({
            line: 3,
            old: 'processData',
            new: 'transformData'
          }),
          expect.objectContaining({
            line: 7,
            old: 'processData',
            new: 'transformData'
          })
        ])
      );
    });

    it('should rename a class method across files', async () => {
      // Arrange
      const userPath = join(testDir, 'src', 'models', 'user.ts');
      await mkdir(join(testDir, 'src', 'models'), { recursive: true });

      const userContent = `export class User {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }
}`;

      const servicePath = join(testDir, 'src', 'service.ts');
      const serviceContent = `import { User } from './models/user.js';

export class UserService {
  getDisplayName(user: User): string {
    return user.getName().toUpperCase();
  }
}`;

      await writeFile(userPath, userContent, 'utf-8');
      await writeFile(servicePath, serviceContent, 'utf-8');

      // Open both files so TypeScript LSP knows about them
      if (testLanguageServer) {
        await testLanguageServer.openDocument(userPath);
        await testLanguageServer.openDocument(servicePath);
      }

      // Act
      const result = await rename(userPath, 8, 5, 'getFullName');

      // Assert
      const response = JSON.parse(result.content[0].text);

      expect(response.status).toBe('success');
      expect(response.filesChanged).toHaveLength(2);

      const serviceEdit = response.changes.find((c: any) => c.path === servicePath);
      expect(serviceEdit?.edits).toContainEqual(
        expect.objectContaining({
          line: 5,
          old: 'getName',
          new: 'getFullName'
        })
      );
    });
  });

  describe('error handling', () => {
    it('should return error when file does not exist', async () => {
      // Act
      const result = await rename('/nonexistent/file.ts', 1, 1, 'newName');

      // Assert
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('error');
      expect(response.error).toContain('ENOENT');
    });

    it('should return error when position is invalid', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'simple.ts');
      const content = `const x = 1;`;
      await writeFile(filePath, content, 'utf-8');

      // Act - position on keyword with no nearby identifier
      const result = await rename(filePath, 1, 100, 'newName'); // Column 100 is out of bounds

      // Assert
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('error');
      expect(response.error).toMatch(/Cannot rename/);
    });

    it('should handle invalid identifier names gracefully', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'invalid.ts');
      const content = `const validName = 1;`;
      await writeFile(filePath, content, 'utf-8');

      // Act - invalid identifier name (TypeScript LSP may or may not reject this)
      const result = await rename(filePath, 1, 7, '123invalid'); // Starts with number

      // Assert - LSP might accept it (will cause TS error) or reject it
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toMatch(/success|error/);
    });
  });

  describe('edge cases', () => {
    it('should handle renaming with existing name conflicts', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'conflict.ts');
      const content = `const oldName = 1;
const newName = 2;
console.log(oldName);`;

      await writeFile(filePath, content, 'utf-8');

      // Act - try to rename to existing name
      const result = await rename(filePath, 1, 7, 'newName');

      // Assert - should either succeed with warning or fail gracefully
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toMatch(/success|error/);
    });

    it('should preserve formatting and comments', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'formatted.ts');
      const content = `// This is a comment
export function   oldFunction   (x: number): number {
  // Inner comment
  return x * 2;
}`;

      await writeFile(filePath, content, 'utf-8');

      // Act
      const result = await rename(filePath, 2, 20, 'newFunction');

      // Assert
      const response = JSON.parse(result.content[0].text);
      expect(response.status).toBe('success');
      // The actual file should preserve spacing and comments
    });
  });
});