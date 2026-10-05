import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { existsSync, realpathSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { CleanupCodebaseOperation } from '../cleanup-codebase.js';
import { createCleanupCodebaseOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

describe('cleanupCodebase', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let testDir: string;

  beforeAll(() => {
    testDir = createTestDir();
    return setupTestWorkspace(testDir);
  });

  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should cleanup multiple TypeScript files', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'file1.ts');
    const file2Path = join(testDir, 'src', 'file2.ts');

    // Use unsorted imports that can be organized
    await writeFile(
      file1Path,
      `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`,
      'utf-8',
    );

    await writeFile(
      file2Path,
      `import { b, a, c } from './utils.js';

const result = a + b + c;
console.error(result);`,
      'utf-8',
    );

    await writeFile(
      join(testDir, 'src', 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src'),
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');
    expect(response.message).toContain('Processed');

    // Verify file1 imports were organized (alphabetically sorted)
    const file1Content = await readFile(file1Path, 'utf-8');
    // Should be sorted: a, b, c instead of c, a, b
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');

    // Verify file2 imports were organized
    const file2Content = await readFile(file2Path, 'utf-8');
    const file2FirstLine = file2Content.split('\n')[0];
    expect(file2FirstLine).toContain('{ a, b, c }');
  });

  it('should support preview mode', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'file1.ts');
    const originalContent = `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`;

    await writeFile(file1Path, originalContent, 'utf-8');
    await writeFile(
      join(testDir, 'src', 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src'),
      preview: true,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Preview:');
    expect(response.message).toContain('cleanup');
    expect(response.preview).toBeDefined();
    expect(response.preview?.filesAffected).toBeGreaterThan(0);
    expect(response.preview?.command).toContain('preview: false');

    // Verify file was NOT modified
    const fileContent = await readFile(file1Path, 'utf-8');
    expect(fileContent).toBe(originalContent);
  });

  it('should return error when directory is empty', async () => {
    // Arrange
    const emptyDir = join(testDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    // Act
    const response = await operation!.execute({
      directory: emptyDir,
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('No TypeScript files found');
  });

  it('should remove unused exports', async () => {
    // Arrange
    const mainPath = join(testDir, 'src', 'main.ts');
    const utilsPath = join(testDir, 'src', 'utils.ts');

    await writeFile(
      mainPath,
      `import { usedFunc } from './utils.js';
console.log(usedFunc());`,
      'utf-8',
    );

    await writeFile(
      utilsPath,
      `export function usedFunc() {
  return 42;
}

export function unusedFunc() {
  return 100;
}`,
      'utf-8',
    );

    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        type: 'module',
      }),
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: testDir,
      entrypoints: ['main\\.ts$'],
      deleteUnusedFiles: true,
    });

    // Assert
    expect(response.success).toBe(true);

    // Verify unusedFunc was removed
    const utilsContent = await readFile(utilsPath, 'utf-8');
    expect(utilsContent).toContain('usedFunc');
    expect(utilsContent).not.toContain('unusedFunc');
  });

  it('should skip node_modules directory', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const nodeModulesDir = join(srcDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    await writeFile(
      join(srcDir, 'file.ts'),
      `const x = 1;
console.error(x);`,
      'utf-8',
    );

    await writeFile(
      join(nodeModulesDir, 'library.ts'),
      `const y = 2;
console.error(y);`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: srcDir,
    });

    // Assert
    expect(response.success).toBe(true);
    // Should only process 1 file (not the one in node_modules)
    expect(response.message).toContain('Processed 1 TypeScript file');
  });

  it('should only report files that actually changed', async () => {
    // Arrange
    const file1Path = join(testDir, 'src', 'clean-file.ts');
    const file2Path = join(testDir, 'src', 'needs-cleanup.ts');

    // File with already-organized imports (no changes needed)
    await writeFile(
      file1Path,
      `import { a, b, c } from './utils.js';

const x = a + b + c;
console.error(x);`,
      'utf-8',
    );

    // File with unsorted imports (needs organizing)
    await writeFile(
      file2Path,
      `import { c, b, a } from './utils.js';

const y = a + b + c;
console.error(y);`,
      'utf-8',
    );

    await writeFile(
      join(testDir, 'src', 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: join(testDir, 'src'),
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.filesChanged).toBeDefined();
    expect(Array.isArray(response.filesChanged)).toBe(true);

    // filesChanged should be array of objects with path and edits
    expect(response.filesChanged.length).toBe(1);

    const changedFile = response.filesChanged[0];
    expect(changedFile).toHaveProperty('path');
    expect(changedFile).toHaveProperty('edits');
    expect(changedFile.path).toBe(file2Path);
    expect(Array.isArray(changedFile.edits)).toBe(true);
    expect(changedFile.edits.length).toBeGreaterThan(0);

    // file1 should NOT be in filesChanged (was already clean)
    expect(response.filesChanged.every((f) => f.path !== file1Path)).toBe(true);
  });

  it('should work with relative directory path', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const file1Path = join(srcDir, 'rel-file1.ts');

    await writeFile(
      file1Path,
      `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`,
      'utf-8',
    );

    await writeFile(
      join(srcDir, 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
      'utf-8',
    );

    const relativeSrcDir = srcDir.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      directory: relativeSrcDir,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');

    const file1Content = await readFile(file1Path, 'utf-8');
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');
  });

  it('should work with absolute directory path', async () => {
    // Arrange
    const srcDir = join(testDir, 'src');
    const file1Path = join(srcDir, 'abs-file1.ts');

    await writeFile(
      file1Path,
      `import { c, a, b } from './utils.js';

const x = a + b + c;
console.error(x);`,
      'utf-8',
    );

    await writeFile(
      join(srcDir, 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: srcDir,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');

    const file1Content = await readFile(file1Path, 'utf-8');
    const file1FirstLine = file1Content.split('\n')[0];
    expect(file1FirstLine).toContain('{ a, b, c }');
  });

  it('should return summary for large codebases (>20 files)', async () => {
    // Arrange
    const largeDir = join(testDir, 'large');
    await mkdir(largeDir, { recursive: true });

    // Create 25 files with unsorted imports
    for (let i = 1; i <= 25; i++) {
      const filePath = join(largeDir, `file${i}.ts`);
      await writeFile(
        filePath,
        `import { z, b, a } from './utils.js';

const value${i} = a + b;
console.error(value${i}, z);`,
        'utf-8',
      );
    }

    await writeFile(
      join(largeDir, 'utils.ts'),
      `export const a = 1;
export const b = 2;
export const z = 3;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: largeDir,
    });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Cleanup completed');
    expect(response.message).toContain('summary'); // Should mention it's a summary

    // Should return simplified edits for large operations
    expect(response.filesChanged).toBeDefined();
    expect(response.filesChanged.length).toBeLessThanOrEqual(20);

    // Verify files were actually modified
    const file1Content = await readFile(join(largeDir, 'file1.ts'), 'utf-8');
    expect(file1Content).toContain('{ a, b, z }'); // Should be sorted
  });

  it('should not execute shell commands smuggled in an entrypoint pattern', async () => {
    // Arrange - src gets a tsconfig.json of its own, as tsr only runs from a
    // directory that has one and the pattern must reach tsr to prove anything
    const markerPath = join(testDir, 'injected.txt');
    await writeFile(join(testDir, 'src', 'tsconfig.json'), '{}', 'utf-8');
    await writeFile(
      join(testDir, 'src', 'main.ts'),
      `export const main = 1;\n`,
      'utf-8',
    );

    // Act - a lone quote closes the quoting around an interpolated pattern,
    // leaving whatever follows it to the shell as its own command
    await operation!.execute({
      directory: join(testDir, 'src'),
      deleteUnusedFiles: true,
      entrypoints: [`main\\.ts$'; touch '${markerPath}'; echo '`],
    });

    // Assert
    expect(existsSync(markerPath)).toBe(false);
  });
});

/**
 * tsr reads its compiler options from the tsconfig.json in the directory it
 * runs in, and cleanup ran it in `directory`. Pointed at a subfolder such as
 * src, it fell back to default compiler options without a word, lost the
 * project's `paths` alias, and deleted a file that is imported through it.
 */
describe('cleanupCodebase deleteUnusedFiles without a tsconfig.json in directory', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;
  let srcDir: string;

  const utilSource = `export const used = 1;\nexport const unused = 2;\n`;

  beforeAll(() => {
    projectRoot = createTestDir();
    srcDir = join(projectRoot, 'src');
    return setupTestWorkspace(projectRoot, {
      strict: true,
      paths: { '@/*': ['./src/*'] },
    });
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  /** util.ts is reachable only through the alias, orphan.ts not at all */
  async function writeAliasedSources(): Promise<void> {
    await writeFile(
      join(srcDir, 'main.ts'),
      `import { used } from '@/util.js';\nconsole.error(used);\n`,
      'utf-8',
    );
    await writeFile(join(srcDir, 'util.ts'), utilSource, 'utf-8');
    await writeFile(
      join(srcDir, 'orphan.ts'),
      `export const nobodyImportsMe = 3;\n`,
      'utf-8',
    );
  }

  it('should refuse a preview from a subfolder and name the project root', async () => {
    // Arrange
    await writeAliasedSources();

    // Act
    const response = await operation!.execute({
      directory: srcDir,
      deleteUnusedFiles: true,
      entrypoints: ['src/main\\.ts$'],
      preview: true,
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('project root');
    expect(response.message.match(/Nearest: (.+)$/m)?.[1]).toBe(projectRoot);
  });

  it('should delete nothing when run from a subfolder', async () => {
    // Arrange
    await writeAliasedSources();

    // Act
    const response = await operation!.execute({
      directory: srcDir,
      deleteUnusedFiles: true,
      entrypoints: ['src/main\\.ts$'],
    });

    // Assert
    expect(existsSync(join(srcDir, 'util.ts'))).toBe(true);
    expect(existsSync(join(srcDir, 'orphan.ts'))).toBe(true);
    expect(await readFile(join(srcDir, 'util.ts'), 'utf-8')).toBe(utilSource);
    expect(response.success).toBe(false);
  });

  it('should say none was found when no directory above has a tsconfig.json', async () => {
    // Arrange - the system temp directory sits outside any TypeScript project
    const looseDir = await mkdtemp(join(tmpdir(), 'cleanup-no-tsconfig-'));
    await writeFile(
      join(looseDir, 'main.ts'),
      `export const main = 1;\n`,
      'utf-8',
    );

    try {
      // Act
      const response = await operation!.execute({
        directory: looseDir,
        deleteUnusedFiles: true,
        entrypoints: ['main\\.ts$'],
        preview: true,
      });

      // Assert
      expect(response.success).toBe(false);
      expect(response.message).toContain('No tsconfig.json found above');
    } finally {
      await rm(looseDir, { recursive: true, force: true });
    }
  });
});

/**
 * tsr exits 1 when it rejects its arguments, and in check mode also when it
 * finds code to remove. Cleanup took every exit 1 for the second, so
 * entrypoints that match no file previewed as changes to make, and a real run
 * reported removing unused code it never looked at. Cleanup now turns such
 * entrypoints away itself, before tsr runs.
 */
describe('cleanupCodebase entrypoints that match no file tsconfig.json includes', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;
  let mainPath: string;

  const mainSource = `import { b, a } from './util.js';\nimport { seeded } from '../scripts/seed.js';\nconsole.error(a, b, seeded);\n`;

  beforeAll(() => {
    projectRoot = createTestDir();
    mainPath = join(projectRoot, 'src', 'main.ts');
    return setupTestWorkspace(projectRoot);
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  /**
   * main.ts imports out of order, so an organize sweep would rewrite it.
   * scripts/seed.ts lies outside tsconfig.json's include; main.ts imports it,
   * which puts it in the program but not among the files tsr takes
   * entrypoints from.
   */
  async function writeSources(): Promise<void> {
    await writeFile(mainPath, mainSource, 'utf-8');
    await mkdir(join(projectRoot, 'scripts'), { recursive: true });
    await writeFile(
      join(projectRoot, 'scripts', 'seed.ts'),
      `export const seeded = true;\n`,
      'utf-8',
    );
    await writeFile(
      join(projectRoot, 'src', 'util.ts'),
      `export const a = 1;\nexport const b = 2;\nexport const unused = 3;\n`,
      'utf-8',
    );
  }

  it('should fail a preview and say what entrypoints are matched against', async () => {
    // Arrange
    await writeSources();

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['scripts/seed\\.ts$'],
      preview: true,
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('match no source file');
    expect(response.message).toContain(
      "regular expressions matched against each file's absolute path",
    );
  });

  it('should fail a real run without changing any file', async () => {
    // Arrange
    await writeSources();

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['scripts/seed\\.ts$'],
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('match no source file');
    expect(await readFile(mainPath, 'utf-8')).toBe(mainSource);
  });
});

/**
 * The organize sweep skipped only node_modules and dot-directories, so run
 * from a project root it also rewrote the imports of the build output in
 * dist.
 */
describe('cleanupCodebase build output', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;

  beforeAll(() => {
    projectRoot = createTestDir();
    return setupTestWorkspace(projectRoot);
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should leave dist untouched while organizing src', async () => {
    // Arrange
    const distDir = join(projectRoot, 'dist');
    const declarationPath = join(distDir, 'main.d.ts');
    const declarationSource = `import { b, a } from './util.js';\nexport declare const pair: [typeof a, typeof b];\n`;
    const mainPath = join(projectRoot, 'src', 'main.ts');

    await mkdir(distDir, { recursive: true });
    await writeFile(
      join(distDir, 'util.d.ts'),
      `export declare const a: number;\nexport declare const b: number;\n`,
      'utf-8',
    );
    await writeFile(declarationPath, declarationSource, 'utf-8');
    await writeFile(
      join(projectRoot, 'src', 'util.ts'),
      `export const a = 1;\nexport const b = 2;\n`,
      'utf-8',
    );
    await writeFile(
      mainPath,
      `import { b, a } from './util.js';\nexport const pair = [a, b];\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({ directory: projectRoot });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(declarationPath, 'utf-8')).toBe(declarationSource);
    expect(await readFile(mainPath, 'utf-8')).toContain(
      `import { a, b } from './util.js';`,
    );
  });
});

/**
 * Entrypoints went to tsr unchecked. One starting with `-` was read as a tsr
 * option, so `--write=…` turned a preview into a write. One matching none of
 * the files tsr loads - including a file tsconfig.json leaves out, or a path
 * through a symlink, where tsr names files by their real path - left tsr only
 * the project's .d.ts files, which it always counts as entrypoints, and a
 * real run deleted everything they do not import. One that was not a regular
 * expression crashed tsr, and cleanup reported success.
 */
describe('cleanupCodebase unchecked entrypoints', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;
  let srcDir: string;

  const utilSource = `export const used = 1;\nexport const unused = 2;\n`;

  beforeAll(() => {
    projectRoot = createTestDir();
    srcDir = join(projectRoot, 'src');
    return setupTestWorkspace(projectRoot);
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  /** Traced from main.ts, orphan.ts and the export `unused` are removable */
  async function writeSources(dir = srcDir): Promise<void> {
    await writeFile(
      join(dir, 'main.ts'),
      `import { used } from './util.js';\nconsole.error(used);\n`,
      'utf-8',
    );
    await writeFile(join(dir, 'util.ts'), utilSource, 'utf-8');
    await writeFile(
      join(dir, 'orphan.ts'),
      `export const nobodyImportsMe = 3;\n`,
      'utf-8',
    );
  }

  it('should not let an entrypoint turn a preview into a write', async () => {
    // Arrange - the second pattern matches main.ts, which gets the list past
    // the check that entrypoints match a source file
    await writeSources();

    // Act
    await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['--write=main\\.ts$', 'main\\.ts$'],
      preview: true,
    });

    // Assert
    expect(existsSync(join(srcDir, 'orphan.ts'))).toBe(true);
    expect(await readFile(join(srcDir, 'util.ts'), 'utf-8')).toBe(utilSource);
  });

  it('should refuse entrypoints that match no source file, deleting nothing', async () => {
    // Arrange - tsr counts env.d.ts as an entrypoint whatever the patterns say
    await writeSources();
    await writeFile(
      join(srcDir, 'env.d.ts'),
      `declare const buildTime: string;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['src/index\\.ts$'],
    });

    // Assert
    expect(existsSync(join(srcDir, 'main.ts'))).toBe(true);
    expect(existsSync(join(srcDir, 'orphan.ts'))).toBe(true);
    expect(await readFile(join(srcDir, 'util.ts'), 'utf-8')).toBe(utilSource);
    expect(response.success).toBe(false);
    expect(response.message).toContain('match no source file');
  });

  it('should name an entrypoint that is not a regular expression', async () => {
    // Arrange
    await writeSources();

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['src/main\\.ts$', 'src/**/*.ts'],
    });

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('"src/**/*.ts" is not');
  });

  it('should refuse entrypoints that match only a file tsconfig.json leaves out, deleting nothing', async () => {
    // Arrange - scripts/seed.ts is a source file in the directory but not in
    // the project, and tsr counts env.d.ts as an entrypoint regardless
    await writeSources();
    await writeFile(
      join(srcDir, 'env.d.ts'),
      `declare const buildTime: string;\n`,
      'utf-8',
    );
    await mkdir(join(projectRoot, 'scripts'), { recursive: true });
    await writeFile(
      join(projectRoot, 'scripts', 'seed.ts'),
      `console.error('seeded');\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['scripts/seed\\.ts$'],
    });

    // Assert
    expect(existsSync(join(srcDir, 'main.ts'))).toBe(true);
    expect(existsSync(join(srcDir, 'orphan.ts'))).toBe(true);
    expect(await readFile(join(srcDir, 'util.ts'), 'utf-8')).toBe(utilSource);
    expect(response.success).toBe(false);
  });

  it('should refuse entrypoints that match only a file imported from outside the include, deleting nothing', async () => {
    // Arrange - the import puts scripts/seed.ts in the program, but tsr takes
    // entrypoints only from the files tsconfig.json includes
    await writeSources();
    const mainSource = `import { used } from './util.js';\nimport { seeded } from '../scripts/seed.js';\nconsole.error(used, seeded);\n`;
    await writeFile(join(srcDir, 'main.ts'), mainSource, 'utf-8');
    await writeFile(
      join(srcDir, 'env.d.ts'),
      `declare const buildTime: string;\n`,
      'utf-8',
    );
    await mkdir(join(projectRoot, 'scripts'), { recursive: true });
    await writeFile(
      join(projectRoot, 'scripts', 'seed.ts'),
      `export const seeded = true;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['scripts/seed\\.ts$'],
    });

    // Assert
    expect(existsSync(join(srcDir, 'main.ts'))).toBe(true);
    expect(existsSync(join(srcDir, 'orphan.ts'))).toBe(true);
    expect(await readFile(join(srcDir, 'main.ts'), 'utf-8')).toBe(mainSource);
    expect(await readFile(join(srcDir, 'util.ts'), 'utf-8')).toBe(utilSource);
    expect(response.success).toBe(false);
  });

  // Where tmpdir() is already a real path, as on Linux, there is no second
  // spelling to test
  it.skipIf(realpathSync(tmpdir()) === tmpdir())(
    'should refuse a pattern spelling the project through a symlink, deleting nothing',
    async () => {
      // Arrange - macOS's tmpdir() is under /var, a link to /private/var, and
      // tsr names each file by the real path of the directory it runs in
      const linkedRoot = await mkdtemp(join(tmpdir(), 'cleanup-linked-'));
      const linkedSrc = join(linkedRoot, 'src');

      try {
        await setupTestWorkspace(linkedRoot);
        await mkdir(linkedSrc);
        await writeSources(linkedSrc);
        await writeFile(
          join(linkedSrc, 'env.d.ts'),
          `declare const buildTime: string;\n`,
          'utf-8',
        );
        const mainPattern = join(linkedSrc, 'main.ts').replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );

        // Act
        const response = await operation!.execute({
          directory: linkedRoot,
          deleteUnusedFiles: true,
          entrypoints: [`^${mainPattern}$`],
        });

        // Assert
        expect(existsSync(join(linkedSrc, 'main.ts'))).toBe(true);
        expect(existsSync(join(linkedSrc, 'orphan.ts'))).toBe(true);
        expect(await readFile(join(linkedSrc, 'util.ts'), 'utf-8')).toBe(
          utilSource,
        );
        expect(response.success).toBe(false);
      } finally {
        await rm(linkedRoot, { recursive: true, force: true });
      }
    },
  );
});

/**
 * A real run took any exit 1 from tsr for success, but tsr --write exits 0
 * whenever it succeeds, so a run it could not finish reported unused code
 * removed. A preview in which tsr found nothing to remove still said it would
 * make changes, and listed tsr's "✔ all good!" as one. And tsr colours its
 * output when CI or FORCE_COLOR is set, which cleanup quoted escape codes and
 * all.
 */
describe("cleanupCodebase reading tsr's result", () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;
  let srcDir: string;

  beforeAll(() => {
    projectRoot = createTestDir();
    srcDir = join(projectRoot, 'src');
    return setupTestWorkspace(projectRoot);
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  /** Traced from main.ts, orphan.ts and the export `unused` are removable */
  async function writeSources(): Promise<void> {
    await writeFile(
      join(srcDir, 'main.ts'),
      `import { used } from './util.js';\nconsole.error(used);\n`,
      'utf-8',
    );
    await writeFile(
      join(srcDir, 'util.ts'),
      `export const used = 1;\nexport const unused = 2;\n`,
      'utf-8',
    );
    await writeFile(
      join(srcDir, 'orphan.ts'),
      `export const nobodyImportsMe = 3;\n`,
      'utf-8',
    );
  }

  // root writes through file modes, so tsr would finish there
  it.skipIf(process.getuid?.() === 0)(
    'should report a real run tsr could not finish as a failure',
    async () => {
      // Arrange - tsr has to rewrite util.ts to drop `unused`, and may not
      await writeSources();
      await chmod(join(srcDir, 'util.ts'), 0o444);

      // Act
      const response = await operation!.execute({
        directory: projectRoot,
        deleteUnusedFiles: true,
        entrypoints: ['src/main\\.ts$'],
      });

      // Assert
      expect(response.success).toBe(false);
      expect(response.message).toContain('EACCES');
    },
  );

  it("should quote a preview's findings as plain text when colours are forced", async () => {
    // Arrange - CI sets CI instead, which turns tsr's colours on just the same
    await writeSources();
    const forceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';

    try {
      // Act
      const response = await operation!.execute({
        directory: projectRoot,
        deleteUnusedFiles: true,
        entrypoints: ['src/main\\.ts$'],
        preview: true,
      });

      // Assert
      expect(response.message).not.toContain('\u001b[');
      expect(response.success).toBe(true);
      expect(response.message).toContain('file   src/orphan.ts');
    } finally {
      if (forceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = forceColor;
    }
  });

  it('should say a preview found nothing to remove when tsr finds nothing', async () => {
    // Arrange - traced from main.ts, every file and export is in use
    await writeFile(
      join(srcDir, 'main.ts'),
      `import { used } from './util.js';\nconsole.error(used);\n`,
      'utf-8',
    );
    await writeFile(
      join(srcDir, 'util.ts'),
      `export const used = 1;\n`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      directory: projectRoot,
      deleteUnusedFiles: true,
      entrypoints: ['src/main\\.ts$'],
      preview: true,
    });

    // Assert
    expect(response.message).not.toContain('would make changes');
    expect(response.success).toBe(true);
    expect(response.message).toContain('No unused exports or files found!');
  });
});

/**
 * The sweep left every file it organized open in tsserver, and each operation
 * re-syncs the open files - a stat apiece - before its first request, so a
 * sweep's cost grew with the square of the files it covered, and every later
 * call paid for all of them.
 */
describe('cleanupCodebase open files', () => {
  let operation: CleanupCodebaseOperation | null = null;
  let testServer: TypeScriptServer | null = null;
  let projectRoot: string;

  beforeAll(() => {
    projectRoot = createTestDir();
    return setupTestWorkspace(projectRoot);
  });

  afterAll(() => cleanupTestWorkspace(projectRoot));

  beforeEach(async () => {
    testServer = await setupTestCase(projectRoot, TypeScriptServer);
    operation = createCleanupCodebaseOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should leave no file open after a sweep', async () => {
    // Arrange
    const srcDir = join(projectRoot, 'src');
    await writeFile(
      join(srcDir, 'shared.ts'),
      `export const x = 1;\nexport const y = 2;\n`,
      'utf-8',
    );
    for (const name of ['a', 'b', 'c', 'd']) {
      await writeFile(
        join(srcDir, `${name}.ts`),
        `import { y, x } from './shared.js';\nexport const ${name} = x + y;\n`,
        'utf-8',
      );
    }

    // Act
    const response = await operation!.execute({ directory: projectRoot });

    // Assert
    expect(response.message).toContain('Organized imports in 4 file(s)');
    expect(testServer!['openFiles'].size).toBe(0);
  });
});
