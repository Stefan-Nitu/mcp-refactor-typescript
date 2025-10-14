# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🐛 Fixed
- **Improved Indentation Detection**: Refactored indentation detection to analyze the entire file using the detect-indent algorithm
  - Detects most common indent difference between consecutive non-empty lines
  - Handles 2-space, 4-space, tab, and even 3-space indentation
  - Properly preserves nesting levels when extracting functions/constants/variables
  - Removed reliance on TSServer's formatOptions (which are ignored by getEditsForRefactor)
  - Custom indentation fixing now respects project-wide indentation patterns

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

[Unreleased]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Stefan-Nitu/mcp-refactor-typescript/releases/tag/v1.0.0
