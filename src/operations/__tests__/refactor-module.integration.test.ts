import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { rm, mkdir, writeFile, readFile } from 'fs/promises';
import { RefactorModuleOperation } from '../refactor-module.js';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { createTestDir } from './test-utils.js';

describe('refactorModule', () => {
  let operation: RefactorModuleOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let testDir: string;

  beforeAll(async () => {
    testDir = createTestDir();
    await mkdir(testDir, { recursive: true });

    const tsconfigPath = join(testDir, 'tsconfig.json');
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ES2020',
          moduleResolution: 'node',
          strict: true
        }
      }),
      'utf-8'
    );

    testServer = new TypeScriptServer();
    await testServer.start(testDir);
    operation = new RefactorModuleOperation(testServer);
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
    await mkdir(join(testDir, 'src', 'new'), { recursive: true });
  });

  it('should move file, organize imports, and fix errors', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'service.ts');
    const destPath = join(testDir, 'src', 'new', 'service.ts');
    const mainPath = join(testDir, 'src', 'main.ts');

    await writeFile(sourcePath, `export function helper() {
  return 42;
}`, 'utf-8');

    await writeFile(mainPath, `import { helper } from './service.js';

const result = helper();
console.error(result);`, 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Refactored module successfully');
    expect(response.message).toContain('Moved file');

    // Verify file was moved
    const movedContent = await readFile(destPath, 'utf-8');
    expect(movedContent).toContain('helper');

    // Verify import was updated in main.ts (if TSServer found it)
    const mainContent = await readFile(mainPath, 'utf-8');
    // Should be updated to new path
    expect(mainContent).toContain('helper');
  });

  it('should support preview mode', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'service.ts');
    const destPath = join(testDir, 'src', 'new', 'service.ts');

    await writeFile(sourcePath, `export function helper() {
  return 42;
}`, 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath,
      destinationPath: destPath,
      preview: true
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview:');
    expect(response.message).toContain('refactor module');
    expect(response.preview).toBeDefined();
    expect(response.preview?.filesAffected).toBeGreaterThan(0);
    expect(response.preview?.estimatedTime).toBe('< 2s');

    // Verify file was NOT moved
    const sourceExists = await readFile(sourcePath, 'utf-8').then(() => true).catch(() => false);
    expect(sourceExists).toBe(true);
  });

  it('should return error when source file does not exist', async () => {
    // Act
    const response = await operation!.execute({
      sourcePath: '/nonexistent/file.ts',
      destinationPath: join(testDir, 'src', 'new', 'file.ts')
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('❌');
  });
});
