# Testing Notes

## Test Workspace Requirements

### TypeScript LSP Dependency

The TypeScript Language Server requires access to the TypeScript installation (`node_modules/typescript`) to function. This has important implications for test workspace setup:

**❌ DO NOT** create test workspaces in system temp directories (e.g., `/tmp`, `os.tmpdir()`)
- The LSP will fail with: `Could not find a valid TypeScript installation`
- No access to project's `node_modules`

**✅ DO** create test workspaces inside the project directory
- Tests can access the project's `node_modules` via relative paths
- Use the `createTestDir()` utility from `src/tools/typescript/__tests__/test-utils.ts`
- Generates unique directories with pattern `.test-workspace-{random-hex}`
- These directories are gitignored and automatically cleaned up

### Example

```typescript
import { createTestDir } from './test-utils.js';

const testDir = createTestDir(); // Creates .test-workspace-abc123def456 in project root
```

### Why This Matters

The typescript-language-server is spawned with:
```typescript
spawn('npx', ['typescript-language-server', '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
  // No cwd specified - runs from current directory
});
```

It looks for TypeScript in the workspace's `node_modules`, which won't exist in isolated temp directories.

## Running Tests

### Watch Mode vs Run Mode

**⚠️ Important**: By default, `npm test` runs in **watch mode** and will NOT exit after tests complete. This can cause timeouts in scripts.

```bash
# ❌ Runs in watch mode - hangs waiting for file changes
npm test

# ✅ Runs once and exits
npm test -- --run

# ✅ Run specific test file
npm test -- --run remove-unused
```

### Test Timeouts

The vitest config has these timeouts:
- `testTimeout: 30000` (30 seconds per test)
- `hookTimeout: 30000` (30 seconds for beforeAll/afterAll)

These are necessary because the TypeScript LSP can take 5-7 seconds to initialize and index the test workspace.

**Full Test Suite Duration**: The complete test suite takes approximately **3-5 minutes** to run due to:
- TypeScript server initialization and file indexing
- Integration tests with real file system operations
- Multiple test workspaces being created and torn down

When running tests programmatically (e.g., in scripts, CI, or Claude Code's Bash tool), ensure adequate timeout:
```bash
# Set 5-minute timeout for full test suite
npm test -- --run  # Takes ~3-5 minutes
```

**For Claude Code Bash tool**: Use `timeout: 300000` (5 minutes) when running the full test suite:
```typescript
Bash({
  command: "npm test -- --run",
  timeout: 300000  // 5 minutes in milliseconds
})
```
