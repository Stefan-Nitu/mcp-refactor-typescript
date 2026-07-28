# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.1.1...HEAD
[2.1.1]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/releases/tag/v1.0.0
