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
mcp-refactor-typescript/
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
