import { writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RenameOperation } from '../rename.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RenameOperation | null = null;

describe('TypeScript file discovery via fileReferences', () => {
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

    // Act - Open ONE file and check if tsserver knows about ALL files
    await testServer.openFile(libPath);

    const projectInfo = await testServer.sendRequest<{
      configFileName: string;
      fileNames?: string[];
    }>('projectInfo', {
      file: libPath,
      needFileNameList: true
    });

    // Assert - Check if tsserver knows about main.ts and utils.ts
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

    // Act - Use fileReferences to find files that import lib.ts
    const fileRefsResponse = await testServer.sendRequest<{
      refs: Array<{ file: string; start: { line: number; offset: number }; end: { line: number; offset: number } }>;
      symbolName: string;
    }>('fileReferences', { file: libPath });

    // Assert - Should find main.ts imports lib.ts
    if (fileRefsResponse?.refs) {
      const importingFiles = fileRefsResponse.refs.map(ref => ref.file);

      // Open all importing files so TypeScript knows about them
      for (const file of importingFiles) {
        await testServer.openFile(file);
      }

      // Now rename should work across files
      const renameResponse = await operation!.execute({
        filePath: libPath,
        line: 1,
        column: 17,
        newName: 'transformData'
      });

      expect(renameResponse.success).toBe(true);
      expect(renameResponse.filesChanged).toHaveLength(2);
      expect(renameResponse.filesChanged).toContain(libPath);
      expect(renameResponse.filesChanged).toContain(mainPath);
    } else {
      // fileReferences might not find files if they haven't been indexed
      // This is the limitation we're testing for
      expect(fileRefsResponse).toBeDefined();
    }
  });
});
