import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { moveFile } from '../move-file.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { TypeScriptLanguageServer } from '../lsp-server.js';
import { existsSync } from 'fs';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

let testLanguageServer: TypeScriptLanguageServer | null = null;

import { vi } from 'vitest';
vi.mock('../lsp-manager.js', () => ({
  getLanguageServer: async () => {
    if (!testLanguageServer) {
      throw new Error('Test language server not initialized');
    }
    return testLanguageServer;
  }
}));

describe('moveFile', () => {
  beforeAll(async () => {
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

    testLanguageServer = new TypeScriptLanguageServer(testDir);
    await testLanguageServer.initialize();

    // Wait for project loading
    await new Promise(resolve => {
      const check = () => {
        if (testLanguageServer?.isProjectLoaded()) {
          resolve(undefined);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
      setTimeout(() => resolve(undefined), 5000);
    });
  });

  afterAll(async () => {
    if (testLanguageServer) {
      await testLanguageServer.shutdown();
      testLanguageServer = null;
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

    if (testLanguageServer) {
      await testLanguageServer.openDocument(utilsPath);
      await testLanguageServer.openDocument(mainPath);
    }

    // Act
    const result = await moveFile(utilsPath, newUtilsPath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    if (response.status !== 'success') {
      console.error('Move file error:', JSON.stringify(response, null, 2));
    }
    expect(response.status).toBe('success');
    expect(response.movedFrom).toBe(utilsPath);
    expect(response.movedTo).toBe(newUtilsPath);

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

    if (testLanguageServer) {
      await testLanguageServer.openDocument(componentPath);
      await testLanguageServer.openDocument(indexPath);
    }

    // Act
    const result = await moveFile(componentPath, newComponentPath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
    expect(existsSync(newComponentPath)).toBe(true);

    const indexContent = await readFile(indexPath, 'utf-8');
    expect(indexContent).toContain('./components/Component.js');
  });

  it('should update relative paths within the moved file', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'service.ts');
    const newFilePath = join(testDir, 'src', 'services', 'user-service.ts');

    // File with various relative path references
    await writeFile(filePath, `import { Position } from '../types/common.js';
import { Helper } from './utils/helper.js';
import { vi } from 'vitest';

const data = require('../types/common.js');

vi.mock('../types/common.js', () => ({
  Position: { line: 1, column: 1 }
}));

export class Service {
  getConfig() {
    return './config.json';  // This should NOT be updated (not a module path)
  }
}`, 'utf-8');

    // Create the files being imported
    await mkdir(join(testDir, 'types'), { recursive: true });
    await mkdir(join(testDir, 'src', 'utils'), { recursive: true });
    await writeFile(join(testDir, 'types', 'common.ts'), 'export interface Position { line: number; column: number; }', 'utf-8');
    await writeFile(join(testDir, 'src', 'utils', 'helper.ts'), 'export class Helper {}', 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act
    const result = await moveFile(filePath, newFilePath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
    expect(existsSync(newFilePath)).toBe(true);

    // Relative module paths within the moved file should be updated
    const movedFileContent = await readFile(newFilePath, 'utf-8');

    // Import statements should be updated by the LSP
    expect(movedFileContent).toContain('../../types/common.js'); // Was ../types, now ../../types
    expect(movedFileContent).toContain('../utils/helper.js');     // Was ./utils, now ../utils

    // require() SHOULD be updated by our custom logic (for lazy loading, etc)
    expect(movedFileContent).toContain("require('../../types/common.js')"); // Should be updated!

    // vi.mock paths SHOULD be updated by our custom logic
    expect(movedFileContent).toContain("vi.mock('../../types/common.js'"); // Should be updated!

    // Non-module paths should NOT be changed
    expect(movedFileContent).toContain("'./config.json'");
  });
});
