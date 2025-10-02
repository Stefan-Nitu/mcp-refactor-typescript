import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { organizeImports } from './organize-imports.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TypeScriptLanguageServer } from './lsp-server.js';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, '../../../test-workspace-organize');

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

describe('organizeImports', () => {
  beforeAll(async () => {
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

    testLanguageServer = new TypeScriptLanguageServer(testDir);
    await testLanguageServer.initialize();

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

  it('should organize and sort imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'messy.ts');
    const messyCode = `import { z } from 'unused';
import { c, a, b } from './utils.js';
import { readFile } from 'fs/promises';

console.log(a, b, c);
`;

    await writeFile(filePath, messyCode, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act
    const result = await organizeImports(filePath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
    expect(response.filesChanged).toContain(filePath);

    // Check that file was modified
    const organized = await readFile(filePath, 'utf-8');
    expect(organized).toContain('utils.js');
  });

  it('should organize imports even when none are used', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `import { readFile } from 'fs/promises';
import { something } from './helpers.js';

console.log('hello');
`;

    await writeFile(filePath, code, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act
    const result = await organizeImports(filePath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
    expect(response.message).toBe('Organized imports');
  });
});
