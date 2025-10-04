import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MoveFileOperation } from '../../../operations/move-file.js';
import { TypeScriptServer } from '../../../language-servers/typescript/tsserver-client.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: MoveFileOperation | null = null;

describe('moveFile', () => {
  beforeAll(async () => {
    // Arrange - Create test workspace
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src'), { recursive: true });

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext"
      },
      include: ["src/**/*"]
    };
    await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

    // Act - Initialize server
    testServer = new TypeScriptServer();
    operation = new MoveFileOperation(testServer);
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

  it('should move file and update imports', async () => {
    // Arrange
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const mainPath = join(testDir, 'src', 'main.ts');
    const newUtilsPath = join(testDir, 'src', 'helpers', 'utils.ts');

    await writeFile(utilsPath, 'export function helper() { return 42; }', 'utf-8');
    await writeFile(mainPath, `import { helper } from './utils.js';\nconsole.log(helper());`, 'utf-8');

    // Open files so TypeScript knows about them
    if (testServer) {
      await testServer.openFile(utilsPath);
      await testServer.openFile(mainPath);
    }

    // Act
    const response = await operation!.execute({
      sourcePath: utilsPath,
      destinationPath: newUtilsPath
    });

    // Assert
    expect(response.success).toBe(true);

    // File should be moved
    expect(existsSync(newUtilsPath)).toBe(true);
    expect(existsSync(utilsPath)).toBe(false);

    // Import should be updated
    const mainContent = await readFile(mainPath, 'utf-8');
    expect(mainContent).toContain('./helpers/utils.js');
    expect(mainContent).not.toContain('./utils.js');
  });

  it('should handle moving file to different directory', async () => {
    // Arrange
    const componentPath = join(testDir, 'src', 'Component.tsx');
    const indexPath = join(testDir, 'src', 'index.ts');
    const newComponentPath = join(testDir, 'src', 'components', 'Component.tsx');

    await writeFile(componentPath, 'export const Component = () => <div>Hello</div>;', 'utf-8');
    await writeFile(indexPath, `import { Component } from './Component.js';\nexport { Component };`, 'utf-8');

    // Open files so TypeScript knows about them
    if (testServer) {
      await testServer.openFile(componentPath);
      await testServer.openFile(indexPath);
    }

    // Act
    const response = await operation!.execute({
      sourcePath: componentPath,
      destinationPath: newComponentPath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(newComponentPath)).toBe(true);

    const indexContent = await readFile(indexPath, 'utf-8');
    expect(indexContent).toContain('./components/Component.js');
  });

  it('should move file even when no imports need updating', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'standalone.ts');
    const newFilePath = join(testDir, 'src', 'utils', 'standalone.ts');

    await writeFile(filePath, 'export const value = 42;', 'utf-8');

    // Act
    const response = await operation!.execute({
      sourcePath: filePath,
      destinationPath: newFilePath
    });

    // Assert
    expect(response.success).toBe(true);
    expect(existsSync(newFilePath)).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });
});
