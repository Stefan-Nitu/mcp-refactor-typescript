# Testing

The tests use Bun's test runner (`bun:test`) and live next to the code they cover, in
`__tests__` directories under `src/`. Most of them drive a real tsserver against real
files.

## Running the tests

Build first: two test files start the built server, `dist/index.js`.

```bash
bun run build
bun run test
```

`bun run test` runs `bun test --timeout 30000 src/`, the whole suite, the way CI runs
it. It takes several minutes, because most tests start their own tsserver.

Two scripts split it by file suffix:

```bash
bun run test:unit          # every *.unit.test.ts and *.contract.test.ts file
bun run test:integration   # every *.integration.test.ts and *.e2e.test.ts file
```

Each includes one of the two tests that start the built server (see "Tests that need a
build"). Neither runs `refactoring-processor.test.ts`, which has no suffix.

To run part of the suite, give `bun test` a path or part of one:

```bash
# One file
bun test --timeout 30000 src/operations/__tests__/rename.integration.test.ts

# Everything under a directory
bun test --timeout 30000 src/operations/shared

# One kind of test, by file suffix
bun test --timeout 30000 .unit.test.ts

# Tests whose name matches a regular expression
bun test --timeout 30000 src/operations/shared -t "sortEdits"
```

- Keep `--timeout 30000`. Bun's default is 5 seconds per test, and starting tsserver
  and indexing a workspace can take longer.
- Each argument is matched against test file paths as plain text, not as a glob.
  `tsc` compiles the tests into `dist/` along with the source, so after a build an
  unscoped filter such as `bun test rename` also runs the compiled copies. Start a
  filter with `src/`, or end it in `.ts` as the suffix example and the two scripts do.

`bun run check` runs the type checker and Biome; the pre-commit hook runs the same two.

## Layout and naming

The file suffix says what kind of test a file holds:

| Suffix | What it tests |
|--------|---------------|
| `*.unit.test.ts` | One module on its own: edit sorting, message parsing, schemas, indentation detection. Helpers that talk to tsserver get a stub `TypeScriptServer` built with Bun's `mock()`. A few, such as the request-timer tests, start a real tsserver, and a few start a small script that plays one, such as a tsserver that never answers `open`. |
| `*.integration.test.ts` | One operation, or a grouped tool through the `OperationRegistry`, against a real tsserver and real files in a test workspace. |
| `*.contract.test.ts` | An external contract. `src/__tests__/mcp-protocol.contract.test.ts` starts the built server and checks the MCP stdio rules: nothing but JSON-RPC on stdout, logs on stderr, a clean exit when stdin closes or on SIGTERM and SIGINT. |
| `*.e2e.test.ts` | `src/__tests__/server-lifecycle.e2e.test.ts`: the registry starts tsserver and registers the operations, and the built server exits, taking its tsserver with it, when stdin closes. |

`src/operations/__tests__/refactoring-processor.test.ts` has no suffix. It is a unit
test of `RefactoringProcessor`, but the `.unit.test.ts` filter does not select it.

Tests follow Arrange, Act, Assert, marked with comments, and are named after the
behaviour they check: `it('should rename a function within a single file', …)`.

## Real tsserver, no mocks

An integration test starts a real `TypeScriptServer`, writes real files, runs the
operation, and asserts on the returned `RefactorResult` and on the files on disk.
Nothing between the operation and tsserver is mocked. Several bugs in
[DEV_NOTES.md](DEV_NOTES.md) came from what tsserver actually returns: byte-counted
frames, fixes without a `fixId`, a moved file still served from its old path. A mock
would have assumed those away. Only the unit tests of helpers stub `TypeScriptServer`.

## Test workspaces

`src/operations/__tests__/test-utils.ts` gives each test file a throwaway project:

```ts
// src/operations/__tests__/example.integration.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { createRenameOperation } from '../shared/operation-factory.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir(); // <repo>/.test-workspace-<16 hex digits>, gitignored
let server: TypeScriptServer | null = null;

describe('rename', () => {
  beforeAll(() => setupTestWorkspace(testDir)); // creates the directory and tsconfig.json
  afterAll(() => cleanupTestWorkspace(testDir)); // deletes the directory

  beforeEach(async () => {
    server = await setupTestCase(testDir, TypeScriptServer); // empty src/, new tsserver
  });
  afterEach(() => cleanupTestCase(server)); // stops tsserver

  it('should rename a constant', async () => {
    // Arrange
    const filePath = join(testDir, 'src', 'math.ts');
    await writeFile(filePath, 'export const sum = 1;\n');

    // Act
    const result = await createRenameOperation(server!).execute({
      filePath,
      line: 1,
      text: 'sum',
      name: 'total',
    });

    // Assert
    expect(result.success).toBe(true);
    expect(await readFile(filePath, 'utf-8')).toContain('total');
  });
});
```

- `setupTestWorkspace(dir, compilerOptions?)` writes a `tsconfig.json` with `target`
  ES2022, `module` and `moduleResolution` NodeNext, `jsx` react and
  `include: ["src/**/*"]`. Pass compiler options to add or override settings.
- `setupTestCase(dir, TypeScriptServer)` deletes and recreates `src/` and starts a new
  tsserver in the workspace, so every test starts clean.
- The tools only accept absolute paths; an operation called directly, as the tests do,
  resolves a relative one against the test process's working directory.
  `createTestDir()` builds the workspace path from the location of `test-utils.ts`, so
  `join(testDir, 'src', …)` is absolute.

The workspaces sit inside the repository, so Node resolution from a workspace reaches
this repository's `node_modules` and tsserver runs the repository's TypeScript. For
the same reason no test in the suite can catch a packaging problem, such as a runtime
dependency missing from `package.json`. The smoke test covers that.

## Tests that need a build

`mcp-protocol.contract.test.ts` and `server-lifecycle.e2e.test.ts` start
`node dist/index.js`. Run `bun run build` before running them, and again after
changing `src/`; otherwise they test stale code, or fail when `dist/` does not exist.
CI builds before it runs the suite.

## Fresh-install smoke test

```bash
bun run test:fresh-install
```

`scripts/fresh-install-smoke-test.mjs` checks what a user gets from npm:

1. It packs the server with `npm pack`, whose `prepack` script builds it, and installs
   the tarball with npm into a new directory under the OS temp directory.
2. It checks that the installed TypeScript is 5.x and ships `lib/tsserver.js`.
3. It creates a project with no TypeScript of its own, starts the installed server
   there through the MCP SDK's stdio client, calls `rename`, and checks that the file
   was rewritten.

It needs npm and network access for the install. CI runs it as a separate job.

## Writing a test

- Write the failing test first ([TDD.md](TDD.md)) and watch it fail. For a bug fix,
  check that the test fails with the fix reverted.
- In integration tests, assert on the files on disk, not only on the message.
- Stop every tsserver a test starts, as `cleanupTestCase()` does.
