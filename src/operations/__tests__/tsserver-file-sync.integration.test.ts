/**
 * Tests that tsserver sees what is on disk for files it already has open.
 *
 * tsserver treats an open file's content as the client's and stops reading it
 * from disk, and nothing ever sent a file again once it was open. Any later
 * write - an editor save, a git checkout, this server's own previous rename -
 * was invisible, so edits computed from the old text were applied to the new
 * one: a comment added above a function turned a rename into
 * `// Utilities forbarmputing values`, reported as a success.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { FindReferencesOperation } from '../find-references.js';
import type { RenameOperation } from '../rename.js';
import {
  createFindReferencesOperation,
  createRenameOperation,
} from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();
const aPath = join(testDir, 'src', 'a.ts');
const bPath = join(testDir, 'src', 'b.ts');

let testServer: TypeScriptServer | null = null;
let findReferences: FindReferencesOperation | null = null;
let rename: RenameOperation | null = null;

describe('tsserver view of files changed on disk', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    findReferences = createFindReferencesOperation(testServer);
    rename = createRenameOperation(testServer);

    await writeFile(
      aPath,
      'export function foo() {\n  return 1;\n}\n',
      'utf-8',
    );
    await writeFile(
      bPath,
      "import { foo } from './a.js';\n\nexport const value = foo();\n",
      'utf-8',
    );
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should rename at the positions a file has after it changed on disk', async () => {
    // Arrange - find_references leaves both files open in tsserver
    await findReferences!.execute({ filePath: aPath, line: 1, text: 'foo' });
    await writeFile(
      aPath,
      '// Utilities for computing values\nexport function foo() {\n  return 1;\n}\n',
      'utf-8',
    );

    // Act
    const response = await rename!.execute({
      filePath: bPath,
      line: 3,
      text: 'foo',
      name: 'bar',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(aPath, 'utf-8')).toBe(
      '// Utilities for computing values\nexport function bar() {\n  return 1;\n}\n',
    );
    expect(await readFile(bPath, 'utf-8')).toBe(
      "import { bar } from './a.js';\n\nexport const value = bar();\n",
    );
  });

  it('should see the edits written by its own previous rename', async () => {
    // Arrange
    await rename!.execute({
      filePath: aPath,
      line: 1,
      text: 'foo',
      name: 'bar',
    });

    // Act
    const response = await rename!.execute({
      filePath: bPath,
      line: 3,
      text: 'bar',
      name: 'baz',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(aPath, 'utf-8')).toBe(
      'export function baz() {\n  return 1;\n}\n',
    );
    expect(await readFile(bPath, 'utf-8')).toBe(
      "import { baz } from './a.js';\n\nexport const value = baz();\n",
    );
  });

  it('should leave out a file deleted from disk after it was opened', async () => {
    // Arrange
    const cPath = join(testDir, 'src', 'c.ts');
    await writeFile(
      cPath,
      "import { foo } from './a.js';\n\nexport const other = foo();\n",
      'utf-8',
    );
    await findReferences!.execute({ filePath: aPath, line: 1, text: 'foo' });
    await rm(cPath);

    // Act
    const response = await rename!.execute({
      filePath: aPath,
      line: 1,
      text: 'foo',
      name: 'bar',
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged.map((change) => change.path).sort()).toEqual(
      [aPath, bPath].sort(),
    );
  });
});
