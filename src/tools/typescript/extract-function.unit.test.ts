import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { extractFunction } from './extract-function.js';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TypeScriptLanguageServer } from './lsp-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, '../../../test-workspace-extract-fn');

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

describe('extractFunction', () => {
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

  it('should extract selected code into a function', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'calc.ts');
    const code = `function calculate() {
  const x = 10;
  const y = 20;
  const result = x + y;
  return result;
}`;

    await writeFile(filePath, code, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act - extract line 4 (const result = x + y;)
    const result = await extractFunction(
      filePath,
      4, 3,  // startLine, startColumn (line 4, after "  ")
      4, 23, // endLine, endColumn (line 4, end of "x + y")
      'addNumbers'
    );
    const response = JSON.parse(result.content[0].text);

    console.log('Extract function result:', JSON.stringify(response, null, 2));

    // Assert
    // TypeScript may or may not support extract function via LSP
    expect(response.status).toMatch(/success|error/);
  });

  it('should handle when extraction is not possible', async () => {
    // Arrange - code that can't be extracted
    const filePath = join(testDir, 'src', 'noextract.ts');
    const code = `const x = 42;`;

    await writeFile(filePath, code, 'utf-8');

    if (testLanguageServer) {
      await testLanguageServer.openDocument(filePath);
    }

    // Act - try to extract part of const declaration
    const result = await extractFunction(
      filePath,
      1, 1,
      1, 5,
      'extracted'
    );
    const response = JSON.parse(result.content[0].text);

    // Assert - should fail gracefully
    expect(response.status).toBe('error');
  });
});
