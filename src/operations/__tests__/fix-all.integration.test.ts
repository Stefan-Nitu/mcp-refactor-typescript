import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { TSDiagnostic } from '../../language-servers/typescript/tsserver-types.js';
import { FixAllOperation } from '../fix-all.js';
import { EditApplicator } from '../shared/edit-applicator.js';
import { FileOperations } from '../shared/file-operations.js';
import { createFixAllOperation } from '../shared/operation-factory.js';
import { TSServerGuard } from '../shared/tsserver-guard.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();
const libPath = join(testDir, 'src', 'lib.ts');
const mainPath = join(testDir, 'src', 'main.ts');

const libSource = `export function makeSlug(name: string): string {
  return name.toLowerCase();
}

export function parseAge(age: string): number {
  return Number(age);
}
`;

// Each name is offered both an import and a stub declaration of its own, and
// the two together do not compile: TS2440, import conflicts with local
const describeSource = `export const describe = (name: string, age: string) => ({
  slug: makeSlug(name),
  age: parseAge(age),
});
`;

// Adds a second kind of error, whose fix is no alternative to an import
const describeAndLoadSource = `${describeSource}
export function load() {
  return await Promise.resolve(1);
}
`;

let testServer: TypeScriptServer | null = null;
let operation: FixAllOperation | null = null;

/** The errors tsserver reports from the content it holds, which need not be the disk's */
async function tsserverErrors(filePath: string): Promise<string[]> {
  const diagnostics = await testServer!.sendRequest<TSDiagnostic[]>(
    'semanticDiagnosticsSync',
    { file: filePath, includeLinePosition: true },
  );
  return (diagnostics ?? []).map((diagnostic) => diagnostic.message);
}

/** The errors in a file as it stands on disk */
async function errorsOnDisk(filePath: string): Promise<string[]> {
  await testServer!.syncOpenFiles();
  return tsserverErrors(filePath);
}

/** fix_all allowed fewer rounds than it ships with */
function fixAllWithRoundLimit(maxRounds: number): FixAllOperation {
  return new FixAllOperation(
    testServer!,
    new FileOperations(),
    new EditApplicator(),
    new TSServerGuard(testServer!),
    maxRounds,
  );
}

describe('fixAll', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createFixAllOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should handle fix_all successfully', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'fixable.ts');
    const code = `const x = 42;
const y = x;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBeDefined();
  });

  it('should return success even when no fixes needed', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'perfect.ts');
    const code = `export const value = 42;\n`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('No fixes needed');
  });

  it('should handle file with unused imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `import { readFile, writeFile } from 'fs/promises';

export const value = 42;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(absolutePath, `export const x = 42;`, 'utf-8');

    const relativePath = absolutePath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(absolutePath, `export const x = 42;`, 'utf-8');

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
    });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should apply a fix that edits a different file', async () => {
    // Arrange - TS2459: the fix inserts `export ` into the declaring file,
    // and carries no fixId because it applies to this one occurrence only
    const consumerPath = join(testDir, 'src', 'consumer.ts');
    const declarerPath = join(testDir, 'src', 'declarer.ts');

    await writeFile(
      declarerPath,
      `const secretValue = 42;\nexport const other = 1;\n`,
      'utf-8',
    );
    await writeFile(
      consumerPath,
      `import { secretValue } from './declarer.js';\nexport const doubled = secretValue * 2;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({ filePath: consumerPath });

    // Assert
    expect(response.message).not.toContain('No auto-fixable errors found');
    expect(response.filesChanged.map((c) => c.path)).toContain(declarerPath);
    expect(await readFile(declarerPath, 'utf-8')).toContain(
      'export const secretValue',
    );
  });

  it('should leave every file untouched when previewing a cross-file fix', async () => {
    // Arrange
    const consumerPath = join(testDir, 'src', 'preview-consumer.ts');
    const declarerPath = join(testDir, 'src', 'preview-declarer.ts');
    const declarerSource = `const hidden = 7;\nexport const kept = 1;\n`;

    await writeFile(declarerPath, declarerSource, 'utf-8');
    await writeFile(
      consumerPath,
      `import { hidden } from './preview-declarer.js';\nexport const tripled = hidden * 3;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: consumerPath,
      preview: true,
    });

    // Assert
    expect(response.filesChanged.map((c) => c.path)).toContain(declarerPath);
    expect(await readFile(declarerPath, 'utf-8')).toBe(declarerSource);
  });

  it('should import names rather than also declare stubs for them', async () => {
    // Arrange
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeSource, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath: mainPath });

    // Assert
    const written = await readFile(mainPath, 'utf-8');
    expect(response.success).toBe(true);
    expect(written).toContain('import { makeSlug, parseAge } from "./lib.js";');
    expect(written).not.toContain('Function not implemented');
    expect(await errorsOnDisk(mainPath)).toEqual([]);
  });

  it('should preview the import alone and write nothing', async () => {
    // Arrange
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeSource, 'utf-8');

    // Act
    const preview = await operation!.execute({
      filePath: mainPath,
      preview: true,
    });
    const afterPreview = await readFile(mainPath, 'utf-8');
    const applied = await operation!.execute({ filePath: mainPath });

    // Assert
    expect(afterPreview).toBe(describeSource);
    expect(JSON.stringify(preview.filesChanged)).not.toContain(
      'Function not implemented',
    );
    expect(preview.filesChanged).toEqual(applied.filesChanged);
  });

  it('should add every missing import in one call', async () => {
    // Arrange
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(
      join(testDir, 'src', 'dates.ts'),
      `export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}
`,
      'utf-8',
    );
    await writeFile(
      mainPath,
      `export const summary = (name: string, age: string, from: Date, to: Date) => ({
  slug: makeSlug(name),
  age: parseAge(age),
  days: daysBetween(from, to),
});
`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({ filePath: mainPath });

    // Assert
    const written = await readFile(mainPath, 'utf-8');
    expect(response.success).toBe(true);
    expect(written).toContain('import { daysBetween } from "./dates.js";');
    expect(written).toContain('import { makeSlug, parseAge } from "./lib.js";');
    expect(written).not.toContain('Function not implemented');
    expect(await errorsOnDisk(mainPath)).toEqual([]);
  });

  it('should fix errors of different kinds in one call', async () => {
    // Arrange
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeAndLoadSource, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath: mainPath });

    // Assert
    const written = await readFile(mainPath, 'utf-8');
    expect(response.success).toBe(true);
    expect(written).toContain('import { makeSlug, parseAge } from "./lib.js";');
    expect(written).toContain('export async function load() {');
    expect(written).not.toContain('Function not implemented');
    expect(await errorsOnDisk(mainPath)).toEqual([]);
  });

  it('should preview fixes of different kinds exactly as a real run applies them', async () => {
    // Arrange
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeAndLoadSource, 'utf-8');

    // Act
    const preview = await operation!.execute({
      filePath: mainPath,
      preview: true,
    });
    const afterPreview = await readFile(mainPath, 'utf-8');
    const errorsAfterPreview = await tsserverErrors(mainPath);
    const applied = await operation!.execute({ filePath: mainPath });

    // Assert - tsserver still holds what is on disk, not the previewed text
    expect(afterPreview).toBe(describeAndLoadSource);
    expect(errorsAfterPreview).toEqual([
      "Cannot find name 'makeSlug'.",
      "Cannot find name 'parseAge'.",
      "'await' expressions are only allowed within async functions and at the top levels of modules.",
    ]);
    expect(preview.filesChanged).toEqual(applied.filesChanged);
  });

  it('should declare a stub only for the name no module exports', async () => {
    // Arrange - the stub fix, applied to the whole file, would declare every
    // unresolved name, the importable ones included
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(
      mainPath,
      `export const describe = (name: string, age: string) => ({
  slug: makeSlug(name),
  age: parseAge(age),
  short: initials(name),
});
`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({ filePath: mainPath });

    // Assert
    const written = await readFile(mainPath, 'utf-8');
    expect(response.success).toBe(true);
    expect(written).toContain('import { makeSlug, parseAge } from "./lib.js";');
    expect(written).toContain('function initials(name: string)');
    expect(written).not.toContain('function makeSlug');
    expect(written).not.toContain('function parseAge');
    expect(await errorsOnDisk(mainPath)).toEqual([]);
  });

  it('should say when it stops at its round limit with fixable errors left', async () => {
    // Arrange - the import takes the one round allowed, leaving the await
    const operationWithLimit = fixAllWithRoundLimit(1);
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeAndLoadSource, 'utf-8');

    // Act
    const preview = await operationWithLimit.execute({
      filePath: mainPath,
      preview: true,
    });
    const applied = await operationWithLimit.execute({ filePath: mainPath });

    // Assert
    const written = await readFile(mainPath, 'utf-8');
    const limitReached =
      'stopped after 1 round(s) with fixable errors left; run fix_all again';
    expect(preview.message).toContain(limitReached);
    expect(applied.message).toContain(limitReached);
    expect(written).toContain('import { makeSlug, parseAge } from "./lib.js";');
    expect(written).not.toContain('async function');
  });

  it('should not mention the round limit when its last round fixes the rest', async () => {
    // Arrange - two rounds needed, two allowed
    const operationWithLimit = fixAllWithRoundLimit(2);
    await writeFile(libPath, libSource, 'utf-8');
    await writeFile(mainPath, describeAndLoadSource, 'utf-8');

    // Act
    const response = await operationWithLimit.execute({ filePath: mainPath });

    // Assert
    expect(response.message).toBe('Applied 2 fix(es) in 1 file(s)');
  });

  it('should explain the missing parameter instead of dumping raw Zod output', async () => {
    // Act
    const response = await operation!.execute({});

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Invalid input');
    expect(response.message).not.toContain('invalid_type');
  });
});

describe('fixAll with noUnusedLocals', () => {
  const strictDir = createTestDir();
  const strictMainPath = join(strictDir, 'src', 'main.ts');
  let strictOperation: FixAllOperation | null = null;

  const startSource = `import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  const plain = 5;
  return 1;
}
`;

  beforeAll(async () => {
    await setupTestWorkspace(strictDir, { noUnusedLocals: true });
    await writeFile(
      join(strictDir, 'package.json'),
      '{ "type": "module" }\n',
      'utf-8',
    );
  });
  afterAll(() => cleanupTestWorkspace(strictDir));

  beforeEach(async () => {
    testServer = await setupTestCase(strictDir, TypeScriptServer);
    strictOperation = createFixAllOperation(testServer);
    await writeFile(
      join(strictDir, 'src', 'app.ts'),
      `export const app = {
  listen(port: number) {
    return port;
  },
};
`,
      'utf-8',
    );
    await writeFile(join(strictDir, 'src', 'lib.ts'), libSource, 'utf-8');
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should keep an unused variable whose initializer may have side effects', async () => {
    // Arrange
    await writeFile(strictMainPath, startSource, 'utf-8');

    // Act
    const response = await strictOperation!.execute({
      filePath: strictMainPath,
    });

    // Assert
    expect(response.message).toBe(
      'Applied 1 fix(es) in 1 file(s). Kept 1 unused declaration whose initializer may have side effects: server (line 4)',
    );
    expect(
      await readFile(strictMainPath, 'utf-8'),
    ).toBe(`import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  return 1;
}
`);
  });

  it('should name the kept declaration in a preview and write nothing', async () => {
    // Arrange
    await writeFile(strictMainPath, startSource, 'utf-8');

    // Act
    const response = await strictOperation!.execute({
      filePath: strictMainPath,
      preview: true,
    });

    // Assert
    expect(response.message).toBe(
      'Preview: Would apply 1 fix(es) in 1 file(s). Would keep 1 unused declaration whose initializer may have side effects: server (line 4)',
    );
    expect(await readFile(strictMainPath, 'utf-8')).toBe(startSource);
  });

  it('should keep it when it is the only error, whose fix has no fixId', async () => {
    // Arrange
    const code = `import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  return 1;
}
`;
    await writeFile(strictMainPath, code, 'utf-8');

    // Act
    const response = await strictOperation!.execute({
      filePath: strictMainPath,
    });

    // Assert
    expect(response.message).toBe(
      'No auto-fixable errors found. Kept 1 unused declaration whose initializer may have side effects: server (line 4)',
    );
    expect(await readFile(strictMainPath, 'utf-8')).toBe(code);
  });

  it('should keep an unused variable whose assignment may have side effects', async () => {
    // Arrange - typed so the assignment is no error of its own, leaving the
    // unused variable the only error: its fix deletes the writes to it too
    const code = `export function start() {
  let handle: unknown = 0;
  handle = setInterval(() => {}, 1000);
  return 1;
}
`;
    await writeFile(strictMainPath, code, 'utf-8');

    // Act
    const response = await strictOperation!.execute({
      filePath: strictMainPath,
    });

    // Assert
    expect(response.message).toBe(
      'No auto-fixable errors found. Kept 1 unused declaration whose assignments may have side effects: handle (line 2)',
    );
    expect(await readFile(strictMainPath, 'utf-8')).toBe(code);
  });

  it('should judge the declarations from the text an earlier round left', async () => {
    // Arrange - the import round inserts a line above both declarations, so
    // the next round's deletion of `plain`, read against the original text,
    // would land on `server` instead
    await writeFile(
      strictMainPath,
      `import { app } from './app.js';

${describeSource}
export function start() {
  const server = app.listen(3000);
  const plain = 5;
  return 1;
}
`,
      'utf-8',
    );

    // Act
    const response = await strictOperation!.execute({
      filePath: strictMainPath,
    });

    // Assert - line 10 in the text the round started from, as in the result
    const written = await readFile(strictMainPath, 'utf-8');
    expect(response.message).toBe(
      'Applied 2 fix(es) in 1 file(s). Kept 1 unused declaration whose initializer may have side effects: server (line 10)',
    );
    expect(written).toContain("import { makeSlug, parseAge } from './lib.js';");
    expect(written).not.toContain('const plain');
    expect(written.split('\n')[9]).toBe('  const server = app.listen(3000);');
  });
});
