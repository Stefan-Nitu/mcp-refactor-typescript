# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-12

### 🚀 Major Changes - Breaking

**Grouped Tools Architecture**

Replaced 14 individual MCP tools with 4 grouped tools, reducing token overhead by 92%.

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
  "tool": "file_operations",
  "params": {
    "operation": "rename",
    "filePath": "src/user.ts",
    "line": 10,
    "text": "getUser",
    "newName": "getUserProfile"
  }
}
```

#### New Tool Groups

1. **file_operations** - File operations with automatic import updates
   - `rename` (was: `rename`)
   - `move` (was: `move_file`)
   - `batch_move` (was: `batch_move_files`)

2. **code_quality** - Code quality and cleanup operations
   - `organize_imports` (was: `organize_imports`)
   - `fix_all` (was: `fix_all`)
   - `remove_unused` (was: `remove_unused`)

3. **refactoring** - Code structure refactoring
   - `extract_function` (was: `extract_function`)
   - `extract_constant` (was: `extract_constant`)
   - `extract_variable` (was: `extract_variable`)
   - `infer_return_type` (was: `infer_return_type`)

4. **workspace** - Project-wide operations
   - `find_references` (was: `find_references`)
   - `refactor_module` (was: `refactor_module`)
   - `cleanup_codebase` (was: `cleanup_codebase`)
   - `restart_tsserver` (was: `restart_tsserver`)

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

### 🐛 Removed

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

[2.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/releases/tag/v1.0.0
