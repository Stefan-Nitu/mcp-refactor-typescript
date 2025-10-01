# MCP Refactor Server

A Model Context Protocol (MCP) server that provides TypeScript/JavaScript refactoring capabilities through the Language Server Protocol (LSP).

## Features

### ✅ Implemented
- **Rename Symbol** - Rename variables, functions, methods, and classes across multiple files
  - Tracks all changes with file paths and line numbers
  - Shows detailed change summary

### 🚧 In Progress
- **Organize Imports** - Remove unused imports and sort them
- **Extract Function** - Extract selected code into a new function
- **Extract Variable** - Extract expressions into variables
- **Fix All** - Apply all available quick fixes
- **Remove Unused** - Remove unused code

### 📋 Planned
- **Move Symbol** - Move functions/classes to different files
- **Inline Variable** - Inline variable values at usage sites
- **Convert Function** - Transform between function styles (arrow ↔ regular)

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcp-servers": {
    "mcp-refactor": {
      "command": "node",
      "args": ["/path/to/mcp-refactor/dist/index.js"]
    }
  }
}
```

### With MCP Inspector

Test the server using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## API

### Tools

#### `typescript` Tool

Performs TypeScript/JavaScript refactoring operations.

**Parameters:**
- `action` (required): One of `rename`, `extract_function`, `extract_variable`, `organize_imports`, `fix_all`, `remove_unused`
- `filePath` (required): Absolute path to the TypeScript/JavaScript file

**Action-specific parameters:**

##### Rename
- `line`: Line number (1-based) of the symbol
- `column`: Column number (1-based) - position within the identifier
- `newName`: New name for the symbol

##### Extract Function/Variable
- `startLine`: Start line of selection (1-based)
- `startColumn`: Start column of selection (1-based)
- `endLine`: End line of selection (1-based)
- `endColumn`: End column of selection (1-based)
- `functionName` (optional): Name for extracted function
- `variableName` (optional): Name for extracted variable

## Examples

### Rename a Method

```json
{
  "tool": "typescript",
  "arguments": {
    "action": "rename",
    "filePath": "/project/src/user.ts",
    "line": 10,
    "column": 5,
    "newName": "getUserDisplayName"
  }
}
```

**Response:**
```json
{
  "tool": "typescript",
  "action": "rename",
  "status": "success",
  "message": "Renamed to \"getUserDisplayName\"",
  "filesChanged": [
    "/project/src/user.ts",
    "/project/src/index.ts"
  ],
  "changes": [
    {
      "file": "user.ts",
      "path": "/project/src/user.ts",
      "edits": [{"line": 10, "old": "getUserName", "new": "getUserDisplayName"}]
    },
    {
      "file": "index.ts",
      "path": "/project/src/index.ts",
      "edits": [{"line": 25, "old": "getUserName", "new": "getUserDisplayName"}]
    }
  ],
  "summary": "Renamed 2 occurrence(s) across 2 file(s)"
}
```

## Development

### Project Structure

```
mcp-refactor/
├── src/
│   ├── index.ts                 # MCP server setup
│   ├── types/                   # TypeScript type definitions
│   ├── tools/
│   │   └── typescript/          # TypeScript refactoring tools
│   │       ├── index.ts         # Tool router
│   │       ├── lsp-server.ts    # TypeScript LSP wrapper
│   │       ├── lsp-manager.ts   # LSP lifecycle management
│   │       ├── rename.ts        # Rename implementation
│   │       └── ...              # Other refactoring operations
│   └── utils/
│       └── workspace-edit.ts    # File modification utilities
├── test/
│   └── fixtures/                # Test files for refactoring
└── docs/                        # Documentation

```

### Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

### Requirements

- Node.js >= 18.0.0
- TypeScript project with `tsconfig.json`
- Files must be valid TypeScript/JavaScript

### Project Status

**Current Implementation:**
- ✅ **Rename refactoring** - Fully implemented with comprehensive unit tests
  - Single file renaming (functions, methods, variables, classes)
  - Cross-file renaming (exported symbols tracked across imports)
  - Error handling (invalid files, positions, and names)
  - Edge cases (name conflicts, formatting preservation)
- ✅ **LSP Integration** - TypeScript Language Server wrapper with lifecycle management
- ✅ **MCP Server** - Basic server structure with STDIO transport
- ⚠️ **Testing** - Unit tests written but hanging on execution (LSP cleanup issue)

**Not Yet Implemented:**
- ❌ Organize imports
- ❌ Extract function/variable
- ❌ Fix all
- ❌ Remove unused code

### Known Issues

1. **Test execution hangs** - Unit tests timeout (likely LSP server shutdown issue)

2. **Cross-file rename** requires:
   - Valid TypeScript with `.js` extensions in ESM imports
   - No type errors between files
   - Proper project configuration

3. **Column position** must be within the identifier for accurate rename

4. **Extract operations** not yet implemented

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT