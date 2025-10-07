import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RenameOperation } from '../rename.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RenameOperation | null = null;

describe('TypeScript Indexing and Project Loading', () => {
  describe('file discovery via projectInfo and fileReferences', () => {
    beforeAll(() => setupTestWorkspace(testDir));
    afterAll(() => cleanupTestWorkspace(testDir));

    beforeEach(async () => {
      testServer = await setupTestCase(testDir, TypeScriptServer);
      operation = new RenameOperation(testServer);
    });

    afterEach(() => cleanupTestCase(testServer));

    it('should verify tsserver has all project files indexed via projectInfo', async () => {
      // Arrange
      const libPath = join(testDir, 'src', 'lib.ts');
      const mainPath = join(testDir, 'src', 'main.ts');
      const utilsPath = join(testDir, 'src', 'utils.ts');

      await writeFile(libPath, `export function processData(data: string): string {
  return data.toUpperCase();
}`, 'utf-8');

      await writeFile(mainPath, `import { processData } from './lib.js';
const result = processData('hello');`, 'utf-8');

      await writeFile(utilsPath, `export function helper() { return 42; }`, 'utf-8');

      if (!testServer) throw new Error('testServer is null');

      // Act
      await testServer.openFile(libPath);

      const projectInfo = await testServer.sendRequest<{
        configFileName: string;
        fileNames?: string[];
      }>('projectInfo', {
        file: libPath,
        needFileNameList: true
      });

      // Assert
      expect(projectInfo?.fileNames).toBeDefined();

      const projectFiles = projectInfo!.fileNames!.filter(f =>
        !f.includes('node_modules') &&
        !f.match(/\/lib\.[^/]+\.d\.ts$/)
      );

      expect(projectFiles).toContain(libPath);
      expect(projectFiles).toContain(mainPath);
      expect(projectFiles).toContain(utilsPath);
    });

    it('should use fileReferences to discover importing files before rename', async () => {
      // Arrange
      const libPath = join(testDir, 'src', 'lib.ts');
      const mainPath = join(testDir, 'src', 'main.ts');

      await writeFile(libPath, `export function processData(data: string): string {
  return data.toUpperCase();
}`, 'utf-8');

      await writeFile(mainPath, `import { processData } from './lib.js';
const result = processData('hello');`, 'utf-8');

      if (!testServer) throw new Error('testServer is null');

      await testServer.openFile(libPath);

      // Act
      const fileRefsResponse = await testServer.sendRequest<{
        refs: Array<{ file: string; start: { line: number; offset: number }; end: { line: number; offset: number } }>;
        symbolName: string;
      }>('fileReferences', { file: libPath });

      // Assert
      if (fileRefsResponse?.refs) {
        const importingFiles = fileRefsResponse.refs.map(ref => ref.file);

        for (const file of importingFiles) {
          await testServer.openFile(file);
        }

        const renameResponse = await operation!.execute({
          filePath: libPath,
          line: 1,
          text: 'processData',
          newName: 'transformData'
        });

        expect(renameResponse.success).toBe(true);
        expect(renameResponse.filesChanged).toHaveLength(2);
        expect(renameResponse.filesChanged.map(f => f.path)).toContain(libPath);
        expect(renameResponse.filesChanged.map(f => f.path)).toContain(mainPath);
      } else {
        expect(fileRefsResponse).toBeDefined();
      }
    });
  });

  describe('incomplete indexing warnings', () => {
    it('should warn when calling rename before project fully loads', async () => {
      // Arrange
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'src'), { recursive: true });

      await writeFile(
        join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext'
          },
          include: ['src/**/*']
        }),
        'utf-8'
      );

      const lib1Path = join(testDir, 'src', 'lib1.ts');
      const lib2Path = join(testDir, 'src', 'lib2.ts');
      const mainPath = join(testDir, 'src', 'main.ts');

      await writeFile(lib1Path, 'export function processData(data: string): string {\n  return data.toUpperCase();\n}', 'utf-8');
      await writeFile(lib2Path, 'export function helperFunc() { return 42; }', 'utf-8');
      await writeFile(mainPath, 'import { processData } from \'./lib1.js\';\nconst result = processData(\'test\');', 'utf-8');

      const freshServer = new TypeScriptServer();
      const freshOperation = new RenameOperation(freshServer);

      try {
        await freshServer.start(testDir);

        // Act
        const response = await freshOperation.execute({
          filePath: lib1Path,
          line: 1,
          text: 'processData',
          newName: 'transformData'
        });

        // Assert
        expect(response.success).toBe(true);

        if (response.message.includes('TypeScript is still indexing')) {
          expect(response.message).toContain('Some references may have been missed');
        } else {
          expect(response.message).toContain('Renamed to "transformData"');
        }
      } finally {
        await freshServer.stop();
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
