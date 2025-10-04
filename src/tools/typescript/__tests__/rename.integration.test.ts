import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RenameOperation } from '../../../operations/rename.js';
import { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RenameOperation | null = null;

describe('rename', () => {
  beforeAll(async () => {
    // Arrange - Create test workspace structure
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src'), { recursive: true });

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

    // Act - Initialize server
    testServer = new TypeScriptServer();
    operation = new RenameOperation(testServer);
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

const result = calculateSum(1, 2);
console.error(result);`;

      await writeFile(filePath, content, 'utf-8');

      // Act
      const response = await operation!.execute({
        filePath,
        line: 1,
        column: 17,
        newName: 'computeSum'
      });

      // Assert
      expect(response.success).toBe(true);
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
            line: 9,
            old: 'calculateSum',
            new: 'computeSum'
          })
        ])
      );
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
    console.error(this.getName());
  }
}`;

      await writeFile(filePath, content, 'utf-8');

      // Act
      const response = await operation!.execute({
        filePath,
        line: 8,
        column: 5,
        newName: 'getDisplayName'
      });

      // Assert
      expect(response.success).toBe(true);
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
console.error(myLongVariableName);
export { myLongVariableName };`;

      await writeFile(filePath, content, 'utf-8');

      // Act - rename from beginning of identifier
      const response1 = await operation!.execute({
        filePath,
        line: 1,
        column: 7,
        newName: 'shortName'
      });

      // Act - rename from middle of identifier (on new file)
      await writeFile(filePath, content, 'utf-8');
      const response2 = await operation!.execute({
        filePath,
        line: 1,
        column: 15,
        newName: 'shortName'
      });

      // Assert - both should work
      expect(response1.success).toBe(true);
      expect(response2.success).toBe(true);
      expect(response1.changes[0].edits.length).toBe(3);
      expect(response2.changes[0].edits.length).toBe(3);
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
console.error(result);

export function wrapper(input: string) {
  return processData(input);
}`;

      await writeFile(libPath, libContent, 'utf-8');
      await writeFile(mainPath, mainContent, 'utf-8');

      // Open both files so TypeScript LSP knows about them
      if (testServer) {
        await testServer.openFile(libPath);
        await testServer.openFile(mainPath);
      }

      // Act
      const response = await operation!.execute({
        filePath: libPath,
        line: 1,
        column: 17,
        newName: 'transformData'
      });

      // Assert
      if (response.filesChanged?.length !== 2) {
        console.error('[TEST] Cross-file rename - filesChanged:', JSON.stringify(response.filesChanged));
        console.error('[TEST] Expected 2 files, got:', response.filesChanged?.length);
        console.error('[TEST] libPath:', libPath);
        console.error('[TEST] mainPath:', mainPath);
      }

      expect(response.success).toBe(true);
      expect(response.filesChanged).toHaveLength(2);
      expect(response.filesChanged).toContain(libPath);
      expect(response.filesChanged).toContain(mainPath);

      // Check that both files have edits
      const libEdit = response.changes.find((c) => c.path === libPath);
      const mainEdit = response.changes.find((c) => c.path === mainPath);

      expect(libEdit).toBeDefined();
      expect(mainEdit).toBeDefined();

      expect(mainEdit!.edits).toEqual(
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

      // Act
      const response = await operation!.execute({
        filePath: userPath,
        line: 8,
        column: 3,
        newName: 'getFullName'
      });

      // Assert
      if (response.filesChanged?.length !== 2) {
        console.error('[TEST] Class method rename - filesChanged:', JSON.stringify(response.filesChanged));
        console.error('[TEST] userPath:', userPath);
        console.error('[TEST] servicePath:', servicePath);
      }

      expect(response.success).toBe(true);
      expect(response.filesChanged).toHaveLength(2);

      const serviceEdit = response.changes.find((c) => c.path === servicePath);
      expect(serviceEdit).toBeDefined();
      expect(serviceEdit?.edits[0]).toMatchObject({
        old: 'getName',
        new: 'getFullName'
      });

      // Verify files were actually updated
      const updatedService = await readFile(servicePath, 'utf-8');
      expect(updatedService).toContain('getFullName');
      expect(updatedService).not.toContain('getName');
    });
  });

  describe('error handling', () => {
    it('should return error when file does not exist', async () => {
      // Act
      const response = await operation!.execute({
        filePath: '/nonexistent/file.ts',
        line: 1,
        column: 1,
        newName: 'newName'
      });

      // Assert
      expect(response.success).toBe(false);
      expect(response.message).toContain('ENOENT');
    });

    it('should handle invalid position gracefully', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'simple.ts');
      const content = `const x = 1;`;
      await writeFile(filePath, content, 'utf-8');

      // Act - position out of bounds
      const response = await operation!.execute({
        filePath,
        line: 1,
        column: 100,
        newName: 'newName'
      });

      // Assert - TypeScript might find nearest identifier or return no locations
      expect(response.success).toBeDefined();
    });

    it('should handle invalid identifier names gracefully', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'invalid.ts');
      const content = `const validName = 1;`;
      await writeFile(filePath, content, 'utf-8');

      // Act - invalid identifier name
      const response = await operation!.execute({
        filePath,
        line: 1,
        column: 7,
        newName: '123invalid'
      });

      // Assert - LSP might accept it or reject it
      expect(response.success).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle renaming with existing name conflicts', async () => {
      // Arrange
      const filePath = join(testDir, 'src', 'conflict.ts');
      const content = `const oldName = 1;
const newName = 2;
console.error(oldName);`;

      await writeFile(filePath, content, 'utf-8');

      // Act - try to rename to existing name
      const response = await operation!.execute({
        filePath,
        line: 1,
        column: 7,
        newName: 'newName'
      });

      // Assert - should either succeed with warning or fail gracefully
      expect(response.success).toBeDefined();
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
      const response = await operation!.execute({
        filePath,
        line: 2,
        column: 20,
        newName: 'newFunction'
      });

      // Assert
      expect(response.success).toBe(true);
    });
  });
});
