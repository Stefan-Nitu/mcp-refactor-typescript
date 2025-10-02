import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { moveFile } from './move-file.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TypeScriptLanguageServer } from './lsp-server.js';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, '../../../test-workspace-move');

let testLanguageServer: TypeScriptLanguageServer | null = null;

import { vi } from 'vitest';
vi.mock('./lsp-manager.js', () => ({
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
});
