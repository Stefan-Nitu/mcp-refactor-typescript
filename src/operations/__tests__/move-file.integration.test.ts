import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { MoveFileOperation } from '../move-file.js';
import { cleanupTestCase, cleanupTestWorkspace, createTestDir, setupTestCase, setupTestWorkspace } from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: MoveFileOperation | null = null;

describe('moveFile', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = new MoveFileOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should move file and update imports', async () => {
    // Arrange
    const utilsPath = join(testDir, 'src', 'utils.ts');
    const mainPath = join(testDir, 'src', 'main.ts');
    const newUtilsPath = join(testDir, 'src', 'helpers', 'utils.ts');

    await writeFile(utilsPath, 'export function helper() { return 42; }', 'utf-8');
    await writeFile(mainPath, `import { helper } from './utils.js';\nconsole.error(helper());`, 'utf-8');

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
