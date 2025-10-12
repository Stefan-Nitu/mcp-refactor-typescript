[![NPM Version](https://img.shields.io/npm/v/mcp-refactor-typescript)](https://www.npmjs.com/package/mcp-refactor-typescript)
[![NPM Downloads](https://img.shields.io/npm/dm/mcp-refactor-typescript)](https://www.npmjs.com/package/mcp-refactor-typescript)
[![CI Status](https://github.com/Stefan-Nitu/mcp-refactor-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/Stefan-Nitu/mcp-refactor-typescript/actions/workflows/ci.yml)
[![MIT Licensed](https://img.shields.io/npm/l/mcp-refactor-typescript)](https://github.com/Stefan-Nitu/mcp-refactor-typescript/blob/main/LICENSE)

# MCP Refactor TypeScript

A Model Context Protocol (MCP) server that provides comprehensive TypeScript/JavaScript refactoring capabilities powered by the TypeScript compiler. Perform complex code transformations with compiler-grade accuracy and type-safety.

## Overview

MCP Refactor TypeScript exposes TypeScript's powerful refactoring engine through the Model Context Protocol, enabling AI assistants and other MCP clients to perform sophisticated code transformations that would be impossible or error-prone to do manually.

**Key Features:**
- **Type-Aware Refactoring** - Uses TypeScript's compiler for accurate, safe transformations
- **Cross-File Support** - Automatically updates imports, exports, and references across your entire codebase
- **Safe** - Preview mode for all destructive operations
- **Detailed Reporting** - See exactly what changed with file paths and line numbers

## Installation

### Via npm (Recommended)

```bash
npm install -g mcp-refactor-typescript
```

The package will be globally installed and available as `mcp-refactor-typescript`.

### From Source

```bash
git clone https://github.com/Stefan-Nitu/mcp-refactor-typescript.git
cd mcp-refactor-typescript
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
    "mcp-refactor-typescript": {
      "command": "npx",
      "args": ["-y", "mcp-refactor-typescript"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "mcp-refactor-typescript": {
      "command": "mcp-refactor-typescript"
    }
  }
}
```

Restart Claude Desktop and you'll have access to all refactoring tools.

### With MCP Inspector

Test the server interactively:

```bash
npx @modelcontextprotocol/inspector npx -y mcp-refactor-typescript
```

Or if installed globally:

```bash
npx @modelcontextprotocol/inspector mcp-refactor-typescript
```

Open http://localhost:5173 to explore available tools and test refactoring operations.

## Available Tools (v2.0)

The server exposes **4 grouped tools** with **15 operations** total. Each tool has a specific domain and uses the `operation` parameter to specify the action.

### Tool Groups

| Tool | Operations | Use When |
|------|-----------|----------|
| **file_operations** | `rename_file`, `move_file`, `batch_move_files` | Renaming/moving files, reorganizing code structure |
| **code_quality** | `organize_imports`, `fix_all`, `remove_unused` | Before commits, after refactoring, cleanup tasks |
| **refactoring** | `rename`, `extract_function`, `extract_constant`, `extract_variable`, `infer_return_type` | Renaming symbols, reducing duplication, improving structure |
| **workspace** | `find_references`, `refactor_module`, `cleanup_codebase`, `restart_tsserver` | Understanding impact, large-scale refactoring, TypeScript issues |

### Operations Reference

| Operation | Tool | Description |
|-----------|------|-------------|
| **rename_file** | file_operations | Rename file in-place with automatic import path updates |
| **move_file** | file_operations | Move file to different directory with import updates |
| **batch_move_files** | file_operations | Move multiple files atomically |
| **organize_imports** | code_quality | Sort and remove unused imports (preserves side-effects) |
| **fix_all** | code_quality | Apply all available TypeScript quick fixes |
| **remove_unused** | code_quality | Remove unused variables and imports safely |
| **rename** | refactoring | Rename symbols across all files with automatic import/export updates |
| **extract_function** | refactoring | Extract code to function with auto-detected parameters/types |
| **extract_constant** | refactoring | Extract magic numbers/strings to named constants |
| **extract_variable** | refactoring | Extract expressions to local variables |
| **infer_return_type** | refactoring | Add return type annotations automatically |
| **find_references** | workspace | Find all usages with type-aware analysis |
| **refactor_module** | workspace | Complete workflow: move + organize + fix |
| **cleanup_codebase** | workspace | Clean entire codebase (organize + optionally delete unused) |
| **restart_tsserver** | workspace | Restart TypeScript server for fresh project state |

> 📖 **Detailed Documentation**: See [docs/OPERATIONS.md](docs/OPERATIONS.md) for full examples, best practices, and workflow patterns for each operation. Also available via MCP resource `operations://catalog`.

## Response Format

All tools return structured JSON:

```json
{
  "tool": "refactoring",
  "operation": "rename",
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

## Example Usage

### Rename a symbol
```json
{
  "tool": "refactoring",
  "params": {
    "operation": "rename",
    "filePath": "src/user.ts",
    "line": 10,
    "text": "getUser",
    "name": "getUserProfile",
    "preview": false
  }
}
```

### Organize imports
```json
{
  "tool": "code_quality",
  "params": {
    "operation": "organize_imports",
    "filePath": "src/index.ts"
  }
}
```

### Extract function
```json
{
  "tool": "refactoring",
  "params": {
    "operation": "extract_function",
    "filePath": "src/calculate.ts",
    "line": 15,
    "text": "x + y",
    "name": "addNumbers"
  }
}
```

### Find references
```json
{
  "tool": "workspace",
  "params": {
    "operation": "find_references",
    "filePath": "src/utils.ts",
    "line": 5,
    "text": "helper"
  }
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
  "name": "getUserProfile",
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
mcp-refactor-typescript/
├── src/
│   ├── index.ts                     # MCP server entry point
│   ├── operation-name.ts            # Operation name enum (single source of truth)
│   ├── registry.ts                  # Operation registry
│   ├── operations/                  # Refactoring operations
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

- Integration tests covering all operations
- Unit tests for validation, error handling, and edge cases
- E2E tests for server startup and initialization
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

- **[OPERATIONS.md](docs/OPERATIONS.md)** - Complete operations reference with examples
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
