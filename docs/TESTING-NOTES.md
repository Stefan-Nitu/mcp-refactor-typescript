# Testing Notes

## Test Workspace Requirements

### Where workspaces live

Create test workspaces with `createTestDir()` from `src/operations/__tests__/test-utils.ts`:
- It returns a unique path, `.test-workspace-{16 hex digits}` in the repository root; `setupTestWorkspace()` creates it and `cleanupTestWorkspace()` deletes it
- These directories are gitignored
- Inside the repository, Node resolution reaches this repository's `node_modules`, so tsserver runs the repository's TypeScript (see [TESTING.md](TESTING.md))

A workspace in the system temp directory also works: tsserver then falls back to the TypeScript this package ships. A few tests use one on purpose, such as those that need a directory with no `tsconfig.json` above it.

### Example

```typescript
import { createTestDir } from './test-utils.js';

const testDir = createTestDir(); // <repo>/.test-workspace-abc123def4567890
```

## Running Tests

```bash
# Run all tests, as CI does (build first: two tests start dist/index.js)
bun run build
bun run test

# Run only the *.unit.test.ts and *.contract.test.ts files
bun run test:unit

# Run only the *.integration.test.ts and *.e2e.test.ts files
bun run test:integration

# Run specific test file
bun test --timeout 30000 src/operations/__tests__/rename.integration.test.ts

# Watch mode
bun test --watch --timeout 30000 src/
```

`test:unit` and `test:integration` give `bun test` file-name suffixes, not globs. `bun run` runs a script with the system shell, where `**` crosses directories only if bash's `globstar` option is on - it is off by default, and the bash 3.2 macOS ships lacks it - so a `src/**/*.unit.test.ts` glob reached no test file at all. `bun test` looks for each argument as plain text in every test file's path, and ending it in `.ts` keeps out the compiled copies `tsc` writes to `dist/`.

### Test Timeouts

Integration tests use a 30-second timeout (configured via `--timeout 30000` in package.json scripts). This is necessary because the TypeScript LSP can take 5-7 seconds to initialize and index the test workspace.

**Full Test Suite Duration**: The complete test suite takes approximately **3-5 minutes** to run due to:
- TypeScript server initialization and file indexing
- Integration tests with real file system operations
- Multiple test workspaces being created and torn down

**For Claude Code Bash tool**: Use `timeout: 300000` (5 minutes) when running the full test suite:
```typescript
Bash({
  command: "bun run test",
  timeout: 300000  // 5 minutes in milliseconds
})
```
