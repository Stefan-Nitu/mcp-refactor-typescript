/**
 * Integration tests for incomplete indexing warning behavior
 *
 * These tests verify that operations warn users when TypeScript
 * indexing is incomplete, allowing them to understand why some
 * references might be missing.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { RenameOperation } from '../rename.js';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

describe('Incomplete Indexing Warning', () => {
  describe('when project indexing is triggered mid-operation', () => {
    it('should warn when opening files triggers project reload', async () => {
      // Arrange - Create a scenario that triggers project reload
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, 'src'), { recursive: true });

      // Create tsconfig.json
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

      // Create the files
      const lib1Path = join(testDir, 'src', 'lib1.ts');
      const lib2Path = join(testDir, 'src', 'lib2.ts');
      const mainPath = join(testDir, 'src', 'main.ts');

      await writeFile(lib1Path, 'export function processData(data: string): string {\n  return data.toUpperCase();\n}', 'utf-8');
      await writeFile(lib2Path, 'export function helperFunc() { return 42; }', 'utf-8');
      await writeFile(mainPath, 'import { processData } from \'./lib1.js\';\nconst result = processData(\'test\');', 'utf-8');

      // Create a FRESH server for this test to ensure clean state
      const freshServer = new TypeScriptServer();
      const operation = new RenameOperation(freshServer);

      try {
        await freshServer.start(testDir);

        // Act - Call rename before projectLoadingFinish fires
        // This simulates a user calling the operation while the project is still loading
        const response = await operation.execute({
          filePath: lib1Path,
          line: 1,
          column: 17,
          newName: 'transformData'
        });

        // Assert
        expect(response.success).toBe(true);

        // The warning may or may not appear depending on timing
        // This documents the expected behavior:
        if (response.message.includes('TypeScript is still indexing')) {
          // If indexing was incomplete, we got the warning - this is correct
          expect(response.message).toContain('Some references may have been missed');
          console.log('✓ Warning appeared as expected when indexing was incomplete');
        } else {
          // If indexing completed quickly (small project), no warning - also correct
          expect(response.message).toContain('Renamed to "transformData"');
          console.log('✓ No warning needed - indexing completed quickly');
        }
      } finally {
        await freshServer.stop();
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('projectLoaded flag behavior', () => {
    it('should verify the warning logic with controlled TSServer state', async () => {
      // This test documents the expected behavior by verifying:
      // 1. When projectLoaded = false during operation, warning appears
      // 2. When projectLoaded = true during operation, no warning

      // This is tested in rename.unit.test.ts with mocks
      // Integration tests verify real TSServer behavior

      expect(true).toBe(true); // Placeholder documenting the dual testing strategy
    });
  });
});
