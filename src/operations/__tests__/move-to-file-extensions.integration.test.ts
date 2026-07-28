/**
 * A project with `allowImportingTsExtensions` writes `.ts` on every specifier.
 * TypeScript normally infers that ending from the imports already in the file
 * it is writing into - but move_to_file writes into a file it just created,
 * which has none, so the ending has to be stated explicitly.
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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { MoveToFileOperation } from '../move-to-file.js';
import { createMoveToFileOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: MoveToFileOperation | null = null;

describe('moveToFile with allowImportingTsExtensions', () => {
  beforeAll(() =>
    setupTestWorkspace(testDir, {
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      noEmit: true,
      verbatimModuleSyntax: true,
    }),
  );
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createMoveToFileOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should keep the .ts extension on imports written into the new file', async () => {
    // Arrange
    const helperPath = join(testDir, 'src', 'helper.ts');
    const sourcePath = join(testDir, 'src', 'source.ts');
    const destPath = join(testDir, 'src', 'moved.ts');

    await writeFile(
      helperPath,
      `export function shared() {
  return 'shared';
}`,
      'utf-8',
    );
    await writeFile(
      sourcePath,
      `import { shared } from './helper.ts';

export function movesAway() {
  return shared();
}

export function staysPut() {
  return 'stays';
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: sourcePath,
      line: 3,
      text: 'movesAway',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);

    const destContent = await readFile(destPath, 'utf-8');
    expect(destContent).toContain("from './helper.ts'");
  });

  it('should keep the .ts extension on the import left behind in the source', async () => {
    // Arrange
    const sourcePath = join(testDir, 'src', 'origin.ts');
    const destPath = join(testDir, 'src', 'extracted.ts');

    await writeFile(
      sourcePath,
      `export function moved() {
  return 'moved';
}

export function caller() {
  return moved();
}`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: sourcePath,
      line: 1,
      text: 'moved',
      destinationPath: destPath,
    });

    // Assert
    expect(response.success).toBe(true);

    // Quote style is TypeScript's to pick; the extension is what matters here
    const sourceContent = await readFile(sourcePath, 'utf-8');
    expect(sourceContent).toMatch(/from ['"]\.\/extracted\.ts['"]/);
  });
});

describe('moveToFile across packages with different tsconfigs', () => {
  const monorepoDir = createTestDir();
  let server: TypeScriptServer | null = null;
  let monorepoOperation: MoveToFileOperation | null = null;

  /** One server, two packages: only `keeps` opts into .ts specifiers */
  beforeAll(async () => {
    await mkdir(join(monorepoDir, 'keeps', 'src'), { recursive: true });
    await mkdir(join(monorepoDir, 'drops', 'src'), { recursive: true });
    await writeFile(
      join(monorepoDir, 'keeps', 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          noEmit: true,
        },
        include: ['src/**/*'],
      }),
      'utf-8',
    );
    await writeFile(
      join(monorepoDir, 'drops', 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
        include: ['src/**/*'],
      }),
      'utf-8',
    );
  });

  afterAll(() => cleanupTestWorkspace(monorepoDir));

  beforeEach(async () => {
    server = new TypeScriptServer();
    await server.start(monorepoDir);
    monorepoOperation = createMoveToFileOperation(server);
  });

  afterEach(() => cleanupTestCase(server));

  it("should not carry one package's ending preference into the next", async () => {
    // Arrange
    const keepsSource = join(monorepoDir, 'keeps', 'src', 'origin.ts');
    const keepsDest = join(monorepoDir, 'keeps', 'src', 'moved.ts');
    const dropsSource = join(monorepoDir, 'drops', 'src', 'origin.ts');
    const dropsDest = join(monorepoDir, 'drops', 'src', 'moved.ts');
    const code = `export function moved() {
  return 'moved';
}

export function caller() {
  return moved();
}`;
    await writeFile(keepsSource, code, 'utf-8');
    await writeFile(dropsSource, code, 'utf-8');

    // Act - the .ts-flavoured package goes first, so a leaked preference shows
    await monorepoOperation!.execute({
      filePath: keepsSource,
      line: 1,
      text: 'moved',
      destinationPath: keepsDest,
    });
    const response = await monorepoOperation!.execute({
      filePath: dropsSource,
      line: 1,
      text: 'moved',
      destinationPath: dropsDest,
    });

    // Assert
    expect(response.success).toBe(true);

    const keepsContent = await readFile(keepsSource, 'utf-8');
    expect(keepsContent).toMatch(/from ['"]\.\/moved\.ts['"]/);

    const dropsContent = await readFile(dropsSource, 'utf-8');
    expect(dropsContent).toMatch(/from ['"]\.\/moved['"]/);
  }, 60000);
});
