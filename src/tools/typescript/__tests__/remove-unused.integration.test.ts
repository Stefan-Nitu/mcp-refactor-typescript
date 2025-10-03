import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { removeUnused } from '../remove-unused.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { TypeScriptLanguageServer } from '../lsp-server.js';
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

describe('removeUnused', () => {
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

  it('should handle remove unused successfully', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `const x = 42;
const y = 100;
console.log(x);
`;

    await writeFile(filePath, code, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act
    const result = await removeUnused(filePath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
  });

  it('should report when no unused code found', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'clean.ts');
    const code = `export const value = 42;\n`;

    await writeFile(filePath, code, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act
    const result = await removeUnused(filePath);
    const response = JSON.parse(result.content[0].text);

    // Assert
    expect(response.status).toBe('success');
  });
});
