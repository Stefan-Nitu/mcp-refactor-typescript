# MCP Refactor Server

A Model Context Protocol (MCP) server that provides comprehensive TypeScript/JavaScript refactoring capabilities powered by the TypeScript compiler. Perform complex code transformations with compiler-grade accuracy and type-safety.

## Overview

The MCP Refactor Server exposes TypeScript's powerful refactoring engine through the Model Context Protocol, enabling AI assistants and other MCP clients to perform sophisticated code transformations that would be impossible or error-prone to do manually.

**Key Features:**
- ✅ **15 Production-Ready Refactoring Tools** - All operations fully implemented and tested
- 🎯 **Type-Aware Refactoring** - Uses TypeScript's compiler for accurate, safe transformations
- 🚀 **Cross-File Support** - Automatically updates imports, exports, and references across your entire codebase
- ⚡ **Fast** - Operations complete in <2s even for large codebases
- 🔒 **Safe** - Preview mode for all destructive operations
- 📝 **Detailed Reporting** - See exactly what changed with file paths and line numbers

## Installation

```bash
npm install
npm run build
```

> ⚠️ Requires Node.js v18.x or higher

## Quick Start

### With Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-refactor": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-refactor/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop and you'll have access to all refactoring tools.

### With MCP Inspector

Test the server interactively:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Open http://localhost:5173 to explore available tools and test refactoring operations.

## Available Tools

All tools return JSON responses with detailed information about what changed:

| Tool | Description | Key Features |
|------|-------------|--------------|
| **rename** | Rename symbols across all files | Type-aware, updates imports/exports |
| **move_file** | Move files and update imports | Zero manual import fixing |
| **batch_move_files** | Move multiple files at once | Atomic operation, perfect for restructuring |
| **organize_imports** | Sort and remove unused imports | Preserves side-effects, type-only imports |
| **fix_all** | Auto-fix TypeScript errors | Compiler-grade fixes |
| **remove_unused** | Remove unused code | Safe, distinguishes side-effect code |
| **find_references** | Find all usages | Catches dynamic imports, JSDoc |
| **extract_function** | Extract code to function | Auto-detects parameters, return type |
| **extract_constant** | Extract literals to constants | Auto-detects optimal scope |
| **extract_variable** | Extract expressions to variables | Type inference, const/let detection |
| **inline_variable** | Inline variable values | Type-safe, handles scope correctly |
| **infer_return_type** | Add return type annotations | Perfect for complex types |
| **refactor_module** | Complete module refactoring | Move + organize + fix in one step |
| **cleanup_codebase** | Clean entire codebase | Remove unused exports + organize imports |
| **restart_tsserver** | Restart TypeScript server | Refresh after config changes |

## Examples

### Rename a Symbol

Rename across all files with automatic import/export updates:

```json
{
  "filePath": "src/user.ts",
  "line": 10,
  "column": 5,
  "newName": "getUserProfile"
}
```

**Response:**
```json
{
  "tool": "rename",
  "status": "success",
  "message": "Renamed to \"getUserProfile\"",
  "data": {
    "filesChanged": ["src/user.ts", "src/index.ts", "src/api.ts"],
    "changes": [...]
  }
}
```

### Move a File

Move file + auto-update ALL imports:

```json
{
  "sourcePath": "src/utils.ts",
  "destinationPath": "src/helpers/utils.ts"
}
```

All files that import from `./utils` automatically update to `./helpers/utils`.

### Extract Function

Extract selected code into a function with auto-detected parameters:

```json
{
  "filePath": "src/calculator.ts",
  "startLine": 15,
  "startColumn": 1,
  "endLine": 18,
  "endColumn": 30,
  "functionName": "calculateTotal"
}
```

TypeScript analyzes the code and determines:
- Which variables need to be parameters
- What the return type should be
- Where to place the new function

### Cleanup Entire Codebase

Remove unused exports and organize imports across all files:

```json
{
  "directory": "src",
  "entrypoints": ["main\\.ts$"]
}
```

Perfect for cleaning up after major refactoring sessions.

### Find All References

Type-aware search that catches everything text search misses:

```json
{
  "filePath": "src/api.ts",
  "line": 42,
  "column": 10
}
```

Finds:
- Direct usages
- Dynamic imports
- Re-exports
- Type-only imports
- JSDoc references

## Response Format

All tools return structured JSON:

```json
{
  "tool": "operation_name",
  "status": "success" | "error",
  "message": "Human-readable summary",
  "data": {
    "filesChanged": ["list", "of", "modified", "files"],
    "changes": [
      {
        "file": "filename.ts",
        "path": "/absolute/path/filename.ts",
        "edits": [
          {
            "line": 42,
            "column": 10,
            "old": "oldText",
            "new": "newText"
          }
        ]
      }
    ]
  },
  "preview": {  // Only when preview: true
    "filesAffected": 5,
    "estimatedTime": "< 1s",
    "command": "Run again with preview: false to apply changes"
  },
  "nextActions": [  // Suggested follow-up operations
    "organize_imports - Clean up import statements",
    "fix_all - Fix any type errors"
  ]
}
```

## Advanced Usage

### Preview Mode

All destructive operations support preview mode:

```json
{
  "filePath": "src/user.ts",
  "line": 10,
  "column": 5,
  "newName": "getUserProfile",
  "preview": true
}
```

Returns what would change without modifying any files.

### Entry Points for Cleanup

Control what's considered "unused" when cleaning codebases:

```json
{
  "directory": "src",
  "entrypoints": [
    "main\\.ts$",           // Main entry point
    ".*\\.test\\.ts$",      // Test files
    "scripts/.*\\.ts$"      // Script files
  ]
}
```

Anything not reachable from these entry points will be removed.

### Batch Operations

Move multiple files atomically:

```json
{
  "files": [
    "src/utils/string.ts",
    "src/utils/number.ts",
    "src/utils/array.ts"
  ],
  "targetFolder": "src/lib"
}
```

All imports update automatically, all files move together or not at all.

## Development

### Project Structure

```
mcp-refactor/
├── src/
│   ├── index.ts                     # MCP server entry point
│   ├── operations/                  # Refactoring operations
│   │   ├── registry.ts             # Operation registry
│   │   ├── rename.ts               # Rename operation
│   │   ├── move-file.ts            # Move file operation
│   │   ├── extract-function.ts     # Extract function operation
│   │   └── ...                     # Other operations
│   ├── language-servers/
│   │   └── typescript/             # TypeScript server client
│   │       ├── tsserver-client.ts  # Direct tsserver communication
│   │       └── tsserver-types.ts   # Protocol type definitions
│   └── utils/
│       ├── logger.ts               # Pino logger (stderr only)
│       └── validation-error.ts     # Zod error formatting
├── test/
│   └── fixtures/                   # Test TypeScript files
└── docs/                           # Architecture & testing docs
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --run rename

# Run in watch mode
npm run test:watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Test Coverage

- **97 integration tests** covering all operations
- **Unit tests** for validation, error handling, and edge cases
- **E2E tests** for server startup and initialization
- All tests use real TypeScript compiler (no mocks)

### Requirements

- **Node.js** >= 18.0.0
- **TypeScript** project with `tsconfig.json`
- Valid TypeScript/JavaScript files
- ESM module resolution (`.js` extensions in imports)

## Architecture

The server uses TypeScript's native `tsserver` for all refactoring operations:

1. **Server Starts**: Detects TypeScript files and starts `tsserver`
2. **Indexing**: TypeScript indexes project files (1-5 seconds for most projects)
3. **Operations**: Each tool sends protocol messages to `tsserver`
4. **Results**: Changes are returned as structured JSON with full details

**Key Design Decisions:**
- Direct `tsserver` communication (not VS Code LSP)
- One `tsserver` instance shared across all operations
- All logging to stderr (MCP protocol compliance)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture information.

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - MCP server architecture and patterns
- **[TESTING.md](docs/TESTING.md)** - Testing strategies and patterns
- **[TESTING-NOTES.md](docs/TESTING-NOTES.md)** - Test workspace setup requirements
- **[ERROR-HANDLING.md](docs/ERROR-HANDLING.md)** - Error handling patterns
- **[MCP-TYPESCRIPT-README.md](docs/MCP-TYPESCRIPT-README.md)** - TypeScript SDK reference

## Troubleshooting

### TypeScript Server Not Starting

If operations fail with "TypeScript server not running":

1. Check that you have TypeScript files in your project
2. Verify `tsconfig.json` exists and is valid
3. Run `restart_tsserver` tool to force a restart
4. Check logs in stderr for detailed error messages

### Incomplete References

If `find_references` or `rename` misses some usages:

1. Wait for TypeScript to finish indexing (check for "Project loaded" in logs)
2. Ensure all files are included in `tsconfig.json`
3. Fix any TypeScript errors that might prevent analysis
4. Use `restart_tsserver` after making project configuration changes

### Import Paths Not Updating

If `move_file` doesn't update some imports:

1. Ensure imports use `.js` extensions (ESM requirement)
2. Check that moved file is part of TypeScript project
3. Verify `tsconfig.json` module resolution settings
4. Look for dynamic imports that TypeScript can't analyze

## Contributing

1. Fork the repository
2. Create a feature branch
3. **Write tests first** (TDD approach)
4. Implement the feature
5. Ensure all tests pass (`npm test`)
6. Run linting (`npm run lint`)
7. Submit a pull request

See [CLAUDE.md](CLAUDE.md) for development guidelines.

## License

MIT

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification and documentation
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - SDK used by this server
- [MCP Servers](https://github.com/modelcontextprotocol/servers) - Official MCP server implementations
