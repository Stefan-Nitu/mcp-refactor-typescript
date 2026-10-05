# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🐛 Fixed

- **tsserver never saw a change to a file it had open**: tsserver stops reading an open file from disk, and nothing sent a file again, so an edit made afterwards — by an editor, by git, or by the server's own previous operation — was invisible, and edits computed from the old text landed on the new one. A rename after a comment was added above the function wrote `// Utilities forbarmputing values` and reported success. Before each operation, every open file whose modification time or size has changed is now sent again, and one deleted from disk is closed.
- **Operations timed out on projects using TypeScript older than 5.6**: the server prefers the project's own TypeScript, and tsserver before 5.6 never answers `open` or `close`, so each operation that opened a file waited out the 30-second timeout on its first `open` and failed with `Request open timed out`. Both are now sent without waiting for a reply. Checked against TypeScript 4.9.
- **tsserver could not start without `node` on `PATH`**: it was spawned as a bare `node`, and desktop MCP clients can start the server through an absolute path to Node with a minimal `PATH`, where every operation failed with `spawn node ENOENT`. tsserver now runs on the Node that runs the server.
- **Requests to an exited tsserver waited 30 seconds each**: the client kept writing to the dead process, and file discovery retries a request up to 30 times, so a tsserver that died during discovery could stall one call for about 15 minutes. Such requests now fail at once, and an `EPIPE` from a write that reaches tsserver as it dies, which could crash the server, is logged instead.
- **tsserver's errors reached users as `undefined`**: tsserver gives a failed request's reason in the response's `message`, and the client read it from the body, which a failure does not have. The error now carries the first line of tsserver's message, such as `Error processing request. No Project.`; the full text is logged at debug level.

## [2.3.0] - 2026-09-22

### 🔒 Security

- **`cleanup_codebase` ran `entrypoints` through a shell**: every pattern was interpolated into a `npx tsr --recursive '…'` command string for `exec`, so a pattern containing a single quote closed the quoting and whatever followed it ran as a separate shell command with the server's privileges. `entrypoints` is chosen by the model, and the model reads the repository it is refactoring, so text planted in that repository could supply one. `tsr` now runs through `execFile` with an argument array, which never starts a shell.

### 🐛 Fixed

- **`fix_all` reported success while leaving fixable errors in place**: it collected the `fixId` of every fix tsserver offered and applied each one's combined fix, but only a fix that belongs to a fix-all family carries a `fixId`. A fix for a single occurrence has none — exporting a name from the module that declares it (TS2459) is one — so it was found and then discarded, and a file whose errors all had fixes like that got `No auto-fixable errors found` with `success: true`. A lone fix with no `fixId` is now applied from its own changes. When a diagnostic has several candidates they are alternatives — which module to import a name from — not a set, and are still skipped.
- **`fix_all` dropped every edit outside the requested file**: a fix is free to edit another file — the TS2459 fix above inserts `export` in the declaring module — and those edits were filtered out without a word. They are now applied to every file they land in, each computed before any is written.
- **Failed tool calls looked successful to MCP clients**: a failure was reported only as `"status": "error"` inside the JSON text, and `isError` — the field a client reads to tell a failed call from a successful one — was never set. It now is, on every failure path.
- **`preview` and `nextActions` never reached the client**: the operations computed both and the response builder dropped them. Both are now returned in `data`.
- **A failure part-way through `rename` or `move_to_file` left it half-applied**: each wrote files one at a time as it computed them, so a file that could not be read or edited stopped the operation after the earlier files were already written — a symbol renamed in some files and not others, or removed from its source with the destination never written. Every file is now read and computed before any is written. A failure while writing is still not rolled back.
- **Request timers outlived their requests**: every tsserver request armed a 30-second timeout that nothing cleared when the reply arrived, so each left a live timer for its full 30 seconds, and a `cleanup_codebase` sweep issues several requests per file. They are now cleared on reply, and no longer hold the process open while a request is in flight.
- **`cleanup_codebase` never ran the `tsr` this package ships**: `npx tsr` ran with its working directory set to the project being cleaned, and `npx` resolves from there, so it never reached this package's `node_modules` — the pinned `tsr` dependency was never the copy that ran, and `npx` fetched its own from the registry at call time. The bundled CLI is now resolved with `createRequire` and run with the current Node.

### ✅ Testing

- `cleanup_codebase` is given a pattern that tries to create a file through the shell, and the test asserts the file does not exist. Before this fix it did.
- `fix_all` on a file that imports a name its module never exported now exports it from that module, and a preview of the same fix reports the edit without writing it. Both tests failed before the fix.
- A rename whose last file cannot be read, and a move whose second file fails to apply, now write nothing; a request's timer is cleared on reply and unref'd. Each test was run with its fix reverted and failed there.

## [2.2.0] - 2026-09-16

### 🐛 Fixed

- **`batch_move_files` with `preview: true` was not a dry run**: it created the target folder before deciding whether to apply anything, so a preview of a move into a new folder left that folder behind, empty. The directory is now created only on a real run.
- **A preview emitted two conflicting edits for every import between two files of the same batch**: each file's move is computed separately against the original layout, so previewing a move of `rule.ts` and `result.ts` into `rules/` asked tsserver about each in isolation and had `'./result.js'` rewritten twice — to `'../result.js'` by one move and to `'./rules/result.js'` by the other. Both files land in the same folder, so the truth is that the specifier does not change at all. Positions claimed by an import within the batch are now resolved against where every file actually ends up, rather than concatenated.
- **`move_file` and `rename_file` reported failure for moves that had already succeeded**: after renaming, every edited file was reloaded by path — including the moved file at the path the rename had just emptied — and reloading re-reads from disk, so moving any file that carries an import of its own failed with `ENOENT` while sitting correctly at its destination. Every existing test moved a leaf file, where the consumer holds the import and the moved file has none, so nothing ever produced an edit inside the file being moved.
- **Imports between files moved in the same batch could be left pointing at the old location**: the `ENOENT` above aborted the notification that tells tsserver a file has moved, so the next file in the batch was computed against a project where the previous move never happened. tsserver is now told the file left its old path; failing to sync no longer fails a move that is already on disk.

### 🔧 Changed

- **zod upgraded to 4.x**: the SDK accepts `zod` `^3.25 || ^4.0`, so holding zod 3 left a resolver free to give the SDK its own zod 4. zod 4 ships a `zod/v3` compat layer, so both copies presented the same type hierarchy under two paths and `tsc` compared them structurally until it hit the instantiation depth limit - the `TS2589` that failed this release's first CI run, reported against the `registerTool` callback rather than anything to do with zod. Cross-field parameter rules moved from `.refine()` to `.superRefine()`, which zod 4 requires for a message that depends on the input; every validation message is unchanged.
- **`@modelcontextprotocol/sdk` now requires `^1.30.0`** rather than `^1.18.1`, matching the version the suite actually runs against.
- **`bun.lock` is committed and every CI and CD install is `--frozen-lockfile`**, with bun pinned to 1.4.2. CI re-resolved every dependency range on every run before this, which is how a commit that passed in July failed in September with no source change.

### ✅ Testing

- Regression tests for each fix: that a preview touches neither the target folder nor any source file, reports no edit for an import between batched files and no two edits at one position, while still reporting both edits in a consumer outside the batch; that files importing each other keep that import intact through a real batch move; and that moving a file which holds an import of its own reports success.

## [2.1.2] - 2026-07-28

### 🐛 Fixed

- **`move_to_file` timed out on any file containing a non-ASCII character**: tsserver sizes each frame with `Buffer.byteLength`, but the parser held its buffer as a decoded string and compared that byte count against `string.length` (UTF-16 units). One emoji or em dash anywhere in the response and the parser waited for bytes that could never arrive as characters, so the request died on the 30-second timeout reporting `Request getEditsForRefactor timed out`. It looked selective because `getApplicableRefactors` returns short ASCII names while `getEditsForRefactor` carries whole source files.
- **`move_to_file` silently dropped the import for the symbol it moved**: TypeScript emits the new import and the declaration's removal both anchored at the same position, and the edit sort applied the insertion first, so the removal deleted it again. Any move where the remaining code still referenced the symbol produced a file that no longer compiled.
- **Restarting tsserver killed its own replacement**: `stop()` armed a 2-second force-kill that re-read `this.process` when it fired and never cleared it, so a restart's new process was SIGKILLed about two seconds later. It read as an intermittent flake only because whether an error surfaced depended on a request being in flight; the kill happened every time. `start()` also carried `projectLoaded` and a half-read parser buffer over from the dead process, making the readiness guard skip its wait.
- **Moved code lost the project's `.ts` import extensions**: TypeScript infers the extension to write from the imports already in the file it edits, and a file it has just created has none. Projects using `allowImportingTsExtensions` got extensionless specifiers that fail under bundler resolution. The ending is now derived from the project's own tsconfig, resolved per file so a monorepo's packages keep their own answer.
- **Per-operation parameter rules were never enforced**: MCP registration takes a schema's raw shape, which discards `.refine()`, so every cross-field rule was dead at the protocol boundary — including the guard requiring `entrypoints` before `cleanup_codebase` deletes files. Rules now run before dispatch.
- **Validation failures dumped raw Zod JSON**: eight operations stringified `ZodError` into the user-facing message. All operations now report which parameter is missing and for which operation.
- **Parser could not recover from a malformed frame**: a header that would never parse, or an implausible `Content-Length`, stalled the stream permanently while the buffer grew without bound.

### 🔧 Changed

- **`file_operations`, `refactoring` and `workspace` parameters are documented in the schema**: every optional parameter now states which operations need it — notably that `rename_file` takes a bare filename rather than a path, and that `deleteUnusedFiles` deletes files and requires `entrypoints`. For an MCP tool the schema is the only documentation the model receives.
- **tsconfig reading delegated to the TypeScript compiler API**, loaded on demand, so JSONC, `extends` chains, arrays and package specifiers behave exactly as `tsc` does.

### ✅ Testing

- Regression tests for each fix above, including a monorepo case proving one package's import-extension preference cannot leak into another.
- New unit tests for `ModuleSpecifierPreference`, and validation-message guards across every operation.

## [2.1.1] - 2026-07-26

### 🐛 Fixed

- **Server was unusable on a fresh install**: `tsserver` was located with a `process.cwd()`-relative path while `typescript` was only a devDependency, so an installed copy had no `tsserver.js` to spawn and every operation failed after a 30-second timeout with a misleading "ensure the file exists" message. It worked during development only because this repo has its own `node_modules/typescript`.
- **TypeScript 7 in a user's project no longer breaks refactoring**: `tsr` declares `typescript: >=4.0.0` as a peer dependency, which npm resolved to TypeScript 7 — the Go port, which ships no `tsserver.js`. `typescript` is now a direct dependency pinned to `~5.9.3`, and projects on TypeScript 7 fall back to the bundled copy.
- **A tsserver that dies is reported immediately**: process `error` and `exit` now reject in-flight requests with the tsserver path and the underlying cause, instead of leaving callers to wait out the 30-second request timeout. Also covers tsserver crashing mid-session.

### 🔧 Changed

- **tsserver resolution prefers the project's own TypeScript**: refactors match the language version the project compiles with, falling back to the bundled TypeScript 5 when the project has none. See `src/language-servers/typescript/resolve-tsserver-path.ts`.
- **`typescript` moved from devDependencies to dependencies** (`~5.9.3`), so the server ships the tsserver it drives.

### ✅ Testing

- **`bun run test:fresh-install`**: packs the tarball, installs it outside the repo, and drives a real rename against a project with no TypeScript installed — the case every in-repo test is blind to. Runs as its own CI job.
- Unit tests for tsserver path resolution and startup failure reporting.

## [2.1.0] - 2026-03-22

### ✨ Added

- **`move_to_file` operation**: Move top-level symbols (functions, interfaces, type aliases) to another file with automatic import updates across the codebase. Supports optional `destinationPath` and preview mode.
- **`MessageParser` class**: Extracted tsserver Content-Length framing logic into a standalone, testable unit with full test coverage.

### 🐛 Fixed

- **tsserver message parser**: Fixed a bug where batched responses (multiple messages in one chunk) could produce corrupt JSON when trailing bytes preceded the `Content-Length` header.

### 🔧 Changed

- **Migrated to Bun**: Runtime, package manager, and test runner now use Bun (>=1.3.8). Node.js (>=18) still supported for runtime consumers via `node dist/index.js`.
- **Migrated to Biome**: Replaced ESLint with Biome for linting and formatting.
- **Migrated to bun:test**: Replaced Vitest with bun:test across all 34 test files.
- **CI/CD**: Updated GitHub Actions workflows to use `oven-sh/setup-bun@v2`.
- **Unit tests run in parallel**, integration tests run serially with 30s timeout.

## [2.0.0] - 2025-01-15

### 🐛 Fixed
- **Improved Indentation Detection**: Refactored indentation detection to analyze the entire file using the detect-indent algorithm
  - Detects most common indent difference between consecutive non-empty lines
  - Handles 2-space, 4-space, tab, and even 3-space indentation
  - Properly preserves nesting levels when extracting functions/constants/variables
  - Extract function now correctly preserves indentation from deeply nested contexts (6+ levels)
  - Removed reliance on TSServer's formatOptions (which are ignored by getEditsForRefactor)
  - Custom indentation fixing now respects project-wide indentation patterns
- **Fixed token limit issue in cleanup_codebase**:
  - Large operations (>20 files) now return summaries to avoid MCP's 25K token limit
  - Shows only first 20 files with simplified edit details when over threshold

### 🚀 Major Changes - Breaking

**Grouped Tools Architecture**

Replaced 15 individual MCP tools with 4 grouped tools, reducing token overhead by 92%.

#### Migration Guide

**Old (v1.x):**
```json
{
  "tool": "rename",
  "params": {
    "filePath": "src/user.ts",
    "line": 10,
    "text": "getUser",
    "newName": "getUserProfile"
  }
}
```

**New (v2.0):**
```json
{
  "tool": "refactoring",
  "params": {
    "operation": "rename",
    "filePath": "src/user.ts",
    "line": 10,
    "text": "getUser",
    "name": "getUserProfile"
  }
}
```

#### New Tool Groups

1. **file_operations** - File operations with automatic import updates
   - `rename_file` - Rename file in-place
   - `move_file` - Move file to different directory
   - `batch_move_files` - Move multiple files atomically

2. **code_quality** - Code quality and cleanup operations
   - `organize_imports` - Sort and remove unused imports
   - `fix_all` - Apply all TypeScript quick fixes
   - `remove_unused` - Remove unused variables and imports

3. **refactoring** - Code structure refactoring
   - `rename` - Rename symbols across all files
   - `extract_function` - Extract code to function
   - `extract_constant` - Extract magic numbers/strings
   - `extract_variable` - Extract expressions to variables
   - `infer_return_type` - Add return type annotations

4. **workspace** - Project-wide operations
   - `find_references` - Find all usages with type-aware analysis
   - `refactor_module` - Complete workflow: move + organize + fix
   - `cleanup_codebase` - Clean entire codebase
   - `restart_tsserver` - Restart TypeScript server

### ✨ Added

- **MCP Annotations**: All tools now include proper `readOnlyHint` and `destructiveHint` annotations
- **Telemetry**: Built-in telemetry logging to stderr for usage tracking and debugging
  - Logs: tool calls, operations, success/failure, duration, files affected
  - Analyze with: `grep tool_call logs/*.log | jq`
- **Operations Catalog Resource**: New MCP resource `operations://catalog` with detailed documentation
  - Full examples for every operation
  - Best practices and workflow patterns
  - Troubleshooting guides
  - Loaded on-demand, not included in tool descriptions
- **Optimized Tool Descriptions**:
  - Reduced from 200-600 characters to 100-200 characters
  - Added "Use when:" guidance for better tool selection
  - Added explicit comparisons vs Edit/Bash/grep tools
  - Concrete time savings metrics

### 🔧 Changed

- Tool descriptions now include "Use when:" scenarios for better LLM tool selection
- Response format includes both `tool` and `operation` fields
- Token overhead reduced from 18,100 tokens to ~1,400 tokens (92% reduction)

### Performance Improvements

**Token Consumption:**
- **Before**: 18,100 tokens (14 separate tools)
- **After**: ~1,400 tokens (4 grouped tools)
- **Savings**: 16,700 tokens (92%)
- **Context freed**: Equivalent to ~40 medium source files

**Tool Selection:**
- Clearer descriptions help LLMs choose the right tool
- Explicit "vs Built-in" comparisons guide tool preference
- "Use when:" scenarios improve pattern matching

### 📚 Documentation

- Updated README with v2.0 tool groups and examples
- Added migration guide in CHANGELOG
- Operations catalog resource with comprehensive examples
- New telemetry logging documentation

### 🗑️ Removed

- Individual tool endpoints (now operations within grouped tools)
- Verbose examples from tool descriptions (moved to operations catalog)
- Redundant validation messages in schemas

## [1.1.0] - 2025-01-10

### Added
- Shared utilities for file operations, text position conversion, and edit application
- Comprehensive integration testing suite
- MCP Inspector support

### Changed
- Refactored operations to use dependency injection
- Improved error handling and validation

## [1.0.0] - 2025-01-05

### Added
- Initial release with 14 refactoring operations
- TypeScript Language Server integration
- Direct tsserver communication
- Comprehensive tool set for TypeScript/JavaScript refactoring
- Preview mode for all destructive operations
- MCP protocol compliance (stderr logging only)

[Unreleased]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/releases/tag/v1.0.0
