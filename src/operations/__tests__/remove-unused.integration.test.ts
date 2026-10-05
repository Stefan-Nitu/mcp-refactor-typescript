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
import type { RemoveUnusedOperation } from '../remove-unused.js';
import { createRemoveUnusedOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;
let operation: RemoveUnusedOperation | null = null;

const LIB_SOURCE = `export const a = 1;
export const b = 2;
export default 3;
`;

const APP_SOURCE = `export const app = {
  port: 3000,
  listen(port: number) {
    return port;
  },
};

export function load() {
  return { host: 'localhost', retries: 3 };
}
`;

/**
 * Every file of a "type": "module" package is an ES module, whose unused
 * top-level declarations TypeScript reports - a script's are globals
 */
async function setupModuleWorkspace(
  dir: string,
  compilerOptions?: Record<string, unknown>,
): Promise<void> {
  await setupTestWorkspace(dir, compilerOptions);
  await writeFile(join(dir, 'package.json'), '{ "type": "module" }\n', 'utf-8');
}

/** Writes main.ts beside the modules it imports from, and returns its path */
async function writeMain(dir: string, code: string): Promise<string> {
  await writeFile(join(dir, 'src', 'lib.ts'), LIB_SOURCE, 'utf-8');
  await writeFile(join(dir, 'src', 'app.ts'), APP_SOURCE, 'utf-8');
  const filePath = join(dir, 'src', 'main.ts');
  await writeFile(filePath, code, 'utf-8');
  return filePath;
}

describe('removeUnused', () => {
  beforeAll(() => setupModuleWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
    operation = createRemoveUnusedOperation(testServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should handle remove unused successfully', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'unused.ts');
    const code = `const x = 42;
const y = 100;
console.error(x);
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    console.log('Response:', JSON.stringify(response, null, 2));
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed');

    // Verify unused variable was actually removed
    const { readFile: read } = await import('node:fs/promises');
    const content = await read(filePath, 'utf-8');
    expect(content).not.toContain('const y');
    expect(content).toContain('const x = 42');
    expect(content).toContain('console.error(x)');
  });

  it('should report when no unused code found', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'clean.ts');
    const code = `export const value = 42;\n`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
  });

  it('should handle file with unused imports', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'imports.ts');
    const code = `import { readFile, writeFile } from 'fs/promises';

export const value = 42;
`;

    await writeFile(filePath, code, 'utf-8');

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);

    // Verify imports were actually removed
    const { readFile: read } = await import('node:fs/promises');
    const content = await read(filePath, 'utf-8');
    expect(content).not.toContain('readFile');
    expect(content).not.toContain('writeFile');
    expect(content).toContain('export const value = 42');
  });

  it('should work with relative file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'relative-test.ts');
    await writeFile(
      absolutePath,
      `const unused = 42;
export const used = 1;`,
      'utf-8',
    );

    const relativePath = absolutePath.replace(`${process.cwd()}/`, '');

    // Act
    const response = await operation!.execute({
      filePath: relativePath,
    });

    // Assert
    expect(response).toBeDefined();
  });

  it('should work with absolute file paths', async () => {
    // Arrange
    const absolutePath = join(testDir, 'src', 'absolute-test.ts');
    await writeFile(
      absolutePath,
      `const unused = 99;
export const used = 1;`,
      'utf-8',
    );

    // Act
    const response = await operation!.execute({
      filePath: absolutePath,
    });

    // Assert
    expect(response).toBeDefined();
  });

  it('should explain the missing parameter instead of dumping raw Zod output', async () => {
    // Act
    const response = await operation!.execute({});

    // Assert
    expect(response.success).toBe(false);
    expect(response.message).toContain('Invalid input');
    expect(response.message).not.toContain('invalid_type');
  });

  it('should remove a lone unused import', async () => {
    // Arrange
    const filePath = await writeMain(
      testDir,
      `import { a } from './lib.js';

export const value = 42;
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed');
    expect(await readFile(filePath, 'utf-8')).toBe(`
export const value = 42;
`);
  });

  it('should remove a lone unused import along with an unused local', async () => {
    // Arrange
    const filePath = await writeMain(
      testDir,
      `import { a } from './lib.js';

export function run() {
  const unusedLocal = 5;
  return 1;
}
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(filePath, 'utf-8')).toBe(`
export function run() {
  return 1;
}
`);
  });

  it('should remove only the unused name from a partly used import', async () => {
    // Arrange
    const filePath = await writeMain(
      testDir,
      `import { a, b } from './lib.js';

export const value = a;
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(
      await readFile(filePath, 'utf-8'),
    ).toBe(`import { a } from './lib.js';

export const value = a;
`);
  });

  it('should remove every unused import binding without editing an import twice', async () => {
    // Arrange - the namespace import is the one shape TypeScript's other fix
    // family removes, and the first line reports the whole declaration unused
    const filePath = await writeMain(
      testDir,
      `import { a, b } from './lib.js';
import def, * as ns from './lib.js';
import other, { b as bee } from './lib.js';
import { a as used, b as unusedB } from './lib.js';

export const value = def + bee + used;
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(await readFile(filePath, 'utf-8')).toBe(`import def from './lib.js';
import { b as bee } from './lib.js';
import { a as used } from './lib.js';

export const value = def + bee + used;
`);
  });

  it('should keep an unused variable whose initializer may have side effects', async () => {
    // Arrange
    const filePath = await writeMain(
      testDir,
      `import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  const plain = 5;
  return 1;
}
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed 1 unused declaration(s)');
    expect(response.message).toContain(
      'Kept 1 unused declaration whose initializer may have side effects: server (line 4)',
    );
    expect(
      await readFile(filePath, 'utf-8'),
    ).toBe(`import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  return 1;
}
`);
  });

  it('should keep every kind of initializer that may have side effects and remove plain ones', async () => {
    // Arrange
    const filePath = await writeMain(
      testDir,
      `import { app } from './app.js';

let counter = 0;
const registry: Record<string, number> = { a: 1 };

export async function* run() {
  const made = new Map();
  const awaited = await Promise.resolve(1);
  const yielded = yield 1;
  const assigned = (counter = 5);
  const bumped = counter++;
  const removed = delete registry.a;
  const tagged = String.raw\`x\`;
  const port = app.port;
  const handler = () => app.listen(1);
  const settings = { retries: 3, onError: () => app.listen(2), tags: ['a', app.port] };
}

export class Poller {
  private timer = setInterval(() => {}, 1000);
  private label = 'poller';
}
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain(
      'Kept 8 unused declarations whose initializers may have side effects: made (line 7), awaited (line 8), yielded (line 9), assigned (line 10), bumped (line 11), removed (line 12), tagged (line 13), timer (line 20)',
    );
    expect(
      await readFile(filePath, 'utf-8'),
    ).toBe(`import { app } from './app.js';

let counter = 0;
const registry: Record<string, number> = { a: 1 };

export async function* run() {
  const made = new Map();
  const awaited = await Promise.resolve(1);
  const yielded = yield 1;
  const assigned = (counter = 5);
  const bumped = counter++;
  const removed = delete registry.a;
  const tagged = String.raw\`x\`;
}

export class Poller {
  private timer = setInterval(() => {}, 1000);
}
`);
  });

  it('should keep a destructured name whose default may have side effects', async () => {
    // Arrange - dropping an element leaves the declaration's own initializer
    // in place, so only its default can be lost; line 6 is every declarator
    // of its statement unused, which TypeScript deletes as one
    const filePath = await writeMain(
      testDir,
      `import { app, load } from './app.js';

export function read(options: { port?: number; retries?: number }) {
  const { port = app.listen(0), retries = 1 } = options;
  const { host, retries: again } = load();
  const { host: unusedHost } = load(), extra = 1;
  return retries + again;
}
`,
    );

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain(
      'Kept 2 unused declarations whose initializers may have side effects: port (line 4), unusedHost (line 6)',
    );
    expect(
      await readFile(filePath, 'utf-8'),
    ).toBe(`import { app, load } from './app.js';

export function read(options: { port?: number; retries?: number }) {
  const { port = app.listen(0), retries = 1 } = options;
  const { retries: again } = load();
  const { host: unusedHost } = load(), extra = 1;
  return retries + again;
}
`);
  });

  it('should report a kept declaration in a preview without writing anything', async () => {
    // Arrange
    const code = `import { app } from './app.js';

export function start() {
  const server = app.listen(3000);
  const plain = 5;
  return 1;
}
`;
    const filePath = await writeMain(testDir, code);

    // Act
    const response = await operation!.execute({ filePath, preview: true });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain(
      'Preview: Would remove 1 unused declaration(s)',
    );
    expect(response.message).toContain(
      'Would keep 1 unused declaration whose initializer may have side effects: server (line 4)',
    );
    expect(response.filesChanged[0].edits).toHaveLength(1);
    expect(await readFile(filePath, 'utf-8')).toBe(code);
  });

  it('should keep the only statement of a file when its initializer may have side effects', async () => {
    // Arrange - deleting a file's only statement covers the whole file, and
    // tsserver places the end of that deletion past the final line break
    const code = `const timer = setInterval(() => {}, 1000);
`;
    const filePath = await writeMain(testDir, code);

    // Act
    const response = await operation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBe(
      'No unused code to remove. Kept 1 unused declaration whose initializer may have side effects: timer (line 1)',
    );
    expect(await readFile(filePath, 'utf-8')).toBe(code);
  });
});

describe('removeUnused with noUnusedLocals', () => {
  const strictDir = createTestDir();
  let server: TypeScriptServer | null = null;
  let strictOperation: RemoveUnusedOperation | null = null;

  beforeAll(() => setupModuleWorkspace(strictDir, { noUnusedLocals: true }));
  afterAll(() => cleanupTestWorkspace(strictDir));

  beforeEach(async () => {
    server = await setupTestCase(strictDir, TypeScriptServer);
    strictOperation = createRemoveUnusedOperation(server);
  });

  afterEach(() => cleanupTestCase(server));

  it('should remove unused imports and locals the option reports as errors', async () => {
    // Arrange
    const filePath = await writeMain(
      strictDir,
      `import { a, b } from './lib.js';

export function run() {
  const unusedLocal = 5;
  return 1;
}
`,
    );

    // Act
    const response = await strictOperation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toBe('Removed 2 unused declaration(s)');
    expect(await readFile(filePath, 'utf-8')).toBe(`
export function run() {
  return 1;
}
`);
  });
});

describe('removeUnused with noUnusedParameters', () => {
  const strictDir = createTestDir();
  let server: TypeScriptServer | null = null;
  let strictOperation: RemoveUnusedOperation | null = null;

  beforeAll(() =>
    setupModuleWorkspace(strictDir, { noUnusedParameters: true }),
  );
  afterAll(() => cleanupTestWorkspace(strictDir));

  beforeEach(async () => {
    server = await setupTestCase(strictDir, TypeScriptServer);
    strictOperation = createRemoveUnusedOperation(server);
  });

  afterEach(() => cleanupTestCase(server));

  it('should remove an unused parameter the option reports as an error', async () => {
    // Arrange
    const filePath = await writeMain(
      strictDir,
      `export function run(used: number, unused: number) {
  return used;
}
`,
    );

    // Act
    const response = await strictOperation!.execute({ filePath });

    // Assert
    expect(response.success).toBe(true);
    expect(response.message).toContain('Removed');
    expect(
      await readFile(filePath, 'utf-8'),
    ).toBe(`export function run(used: number) {
  return used;
}
`);
  });
});
