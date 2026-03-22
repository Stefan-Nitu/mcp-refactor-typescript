# Testing Notes

## Test Workspace Requirements

### TypeScript LSP Dependency

The TypeScript Language Server requires access to the TypeScript installation (`node_modules/typescript`) to function. This has important implications for test workspace setup:

**DO NOT** create test workspaces in system temp directories (e.g., `/tmp`, `os.tmpdir()`)
- The LSP will fail with: `Could not find a valid TypeScript installation`
- No access to project's `node_modules`

**DO** create test workspaces inside the project directory
- Tests can access the project's `node_modules` via relative paths
- Use the `createTestDir()` utility from `src/operations/__tests__/test-utils.ts`
- Generates unique directories with pattern `.test-workspace-{random-hex}`
- These directories are gitignored and automatically cleaned up

### Example

```typescript
import { createTestDir } from './test-utils.js';

const testDir = createTestDir(); // Creates .test-workspace-abc123def456 in project root
```

## Running Tests

```bash
# Run all tests (unit parallel, integration serial)
bun test

# Run only unit/contract tests (parallel)
bun run test:unit

# Run only integration/e2e tests (serial)
bun run test:integration

# Run specific test file
bun test --filter rename

# Watch mode
bun test --watch
```

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
