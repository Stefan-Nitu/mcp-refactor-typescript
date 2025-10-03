import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TypeScriptLanguageServer } from '../lsp-server.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createTestDir } from './test-utils.js';

const testDir = createTestDir();

describe('project loading', () => {
  let testLanguageServer: TypeScriptLanguageServer | null = null;

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
  });

  afterAll(async () => {
    if (testLanguageServer) {
      await testLanguageServer.shutdown();
      testLanguageServer = null;
    }
    await rm(testDir, { recursive: true, force: true });
  });

  it('should handle parallel operations waiting for project load', async () => {
    // Arrange
    testLanguageServer = new TypeScriptLanguageServer(testDir);
    await testLanguageServer.initialize();

    const file1 = join(testDir, 'src', 'test1.ts');
    const file2 = join(testDir, 'src', 'test2.ts');
    const file3 = join(testDir, 'src', 'test3.ts');
    const file4 = join(testDir, 'src', 'test4.ts');
    const file5 = join(testDir, 'src', 'test5.ts');

    await writeFile(file1, 'export function foo() { return 42; }', 'utf-8');
    await writeFile(file2, 'export function bar() { return 43; }', 'utf-8');
    await writeFile(file3, 'export function baz() { return 44; }', 'utf-8');
    await writeFile(file4, 'export function qux() { return 45; }', 'utf-8');
    await writeFile(file5, 'export function quux() { return 46; }', 'utf-8');

    // Act - simulate 5 parallel rename operations (they all check projectLoaded)
    const startTime = Date.now();
    const operations = await Promise.all([
      testLanguageServer.rename(file1, { line: 1, column: 17 }, 'newFoo'),
      testLanguageServer.rename(file2, { line: 1, column: 17 }, 'newBar'),
      testLanguageServer.rename(file3, { line: 1, column: 17 }, 'newBaz'),
      testLanguageServer.rename(file4, { line: 1, column: 17 }, 'newQux'),
      testLanguageServer.rename(file5, { line: 1, column: 17 }, 'newQuux'),
    ]);
    const duration = Date.now() - startTime;

    // Assert
    expect(operations).toHaveLength(5);

    // Should take roughly the time for ONE project load check, not 5x
    // Project loading can take up to 30 seconds for large projects
    // Parallel calls should share the wait, not multiply it
    expect(duration).toBeLessThan(35000); // 35 seconds max (30s timeout + 5s buffer)

    console.error(`[TEST] Parallel operations completed in ${duration}ms`);
  });

  it('should not timeout when parallel calls happen before project loads', async () => {
    // Arrange - create a fresh server to simulate MCP startup
    const freshDir = createTestDir();
    await mkdir(freshDir, { recursive: true });
    await mkdir(join(freshDir, 'src'), { recursive: true });

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext"
      }
    };
    await writeFile(join(freshDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf-8');

    const file1 = join(freshDir, 'src', 'test1.ts');
    const file2 = join(freshDir, 'src', 'test2.ts');
    const file3 = join(freshDir, 'src', 'test3.ts');

    await writeFile(file1, 'export function foo() { return 42; }', 'utf-8');
    await writeFile(file2, 'export function bar() { return 43; }', 'utf-8');
    await writeFile(file3, 'export function baz() { return 44; }', 'utf-8');

    const freshServer = new TypeScriptLanguageServer(freshDir);
    await freshServer.initialize();

    // Act - call operations IMMEDIATELY after initialization, before project loads
    // This simulates multiple MCP tool calls right after server starts
    const operations = await Promise.all([
      freshServer.rename(file1, { line: 1, column: 17 }, 'newFoo'),
      freshServer.rename(file2, { line: 1, column: 17 }, 'newBar'),
      freshServer.rename(file3, { line: 1, column: 17 }, 'newBaz'),
    ]);

    // Assert - operations should succeed, not timeout
    expect(operations).toHaveLength(3);
    operations.forEach(op => {
      expect(op.success).toBe(true);
    });

    await freshServer.shutdown();
    await rm(freshDir, { recursive: true, force: true });
  });
});
