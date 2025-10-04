# MCP Refactoring Tools - Improvement Plan

## Goal
Make MCP refactoring tools the automatic choice for LLMs by making their value obvious and reducing friction.

## 1. Improve Tool Descriptions (High Impact, Low Effort)

### Current (Generic)
```
rename: "Rename a symbol across all files"
move_file: "Move a file and update imports"
```

### Improved (Value-Focused)
```
rename: "⚡ Rename across ALL files + update imports/exports automatically. Impossible to do safely by hand."

move_file: "⚡ Move file + auto-update ALL import paths across entire codebase. Zero manual import fixing."

batch_move_files: "⚡ Reorganize entire modules + update ALL imports automatically. Saves hours of manual work."

find_references: "⚡ Find ALL usages with type-awareness (catches dynamic imports, requires, etc). More thorough than text search."

organize_imports: "⚡ Sort + remove unused imports with TypeScript compiler accuracy. Catches what ESLint misses."

fix_all: "⚡ Auto-fix ALL TypeScript errors at once. Type-aware fixes that preserve correctness."

remove_unused: "⚡ Safely remove ALL unused vars/imports with zero risk of breaking code. Type-aware analysis."

inline_variable: "⚡ Inline variables while preserving types and handling scope correctly. Avoids type narrowing bugs."

infer_return_type: "⚡ Generate perfect return type annotations (even complex nested types). No guessing needed."

extract_constant: "Extract literal to const. Note: Gives generic names - you'll need to rename."

extract_variable: "Extract expression to variable. Note: Gives generic names - you'll need to rename."

extract_function: "Extract code to function. Note: Gives generic names - you'll need to rename."
```

## 2. Add Examples to Descriptions (Medium Impact, Low Effort)

Each tool should show a before/after example:

```typescript
{
  title: "Rename Symbol",
  description: "⚡ Rename across ALL files + update imports/exports automatically.\n\nExample:\n  Rename 'User' to 'Customer'\n  ✓ Updates 47 files\n  ✓ Updates all imports: import { User } → import { Customer }\n  ✓ Updates all type references\n  ✓ Zero manual work",
  inputSchema: {...}
}
```

## 3. Add Performance Metrics (Medium Impact, Low Effort)

Show actual time saved:

```
rename: "⚡ Updates all files in <1s vs ~5-10min manual search/replace"
move_file: "⚡ Completes in <2s vs ~15-30min manually updating imports"
```

## 4. Add "Why Use This" Section (High Impact, Medium Effort)

```typescript
{
  title: "Rename Symbol",
  description: "⚡ Rename across ALL files...",
  why: "Manual renaming risks:\n  ❌ Missing imports in node_modules re-exports\n  ❌ Missing dynamic require() calls\n  ❌ Breaking barrel exports\n  ❌ Hours of work\n  ✅ This tool: TypeScript-aware, catches everything, takes 1 second"
}
```

## 5. Smart Tool Suggestions (High Impact, High Effort)

When LLM uses Edit for a rename, the tool could detect it and suggest:

```json
{
  "message": "💡 Detected rename operation. Use 'rename' tool instead for:\n  ✓ Cross-file updates\n  ✓ Import/export updates\n  ✓ Type reference updates\n  ✓ Guaranteed correctness"
}
```

## 6. Batch Operations (High Impact, Medium Effort)

Add tools that do multiple operations:

```
refactor_module: Combines move_file + organize_imports + fix_all
cleanup_codebase: Combines remove_unused + organize_imports across all files
extract_and_name: Combines extract_constant + rename (solves the naming problem!)
```

## 7. Preview Mode (Medium Impact, Medium Effort)

Add `preview: true` parameter to all tools:

```typescript
{
  preview: true,
  filePath: "src/user.ts",
  line: 10,
  newName: "Customer"
}

Response:
{
  "preview": {
    "filesAffected": 47,
    "filesChanged": ["src/user.ts", "src/auth.ts", ...],
    "changes": [
      {
        "file": "src/user.ts",
        "diff": "- export class User\n+ export class Customer"
      }
    ]
  },
  "estimatedTime": "0.8s",
  "command": "Approve by calling again with preview: false"
}
```

## 8. Confidence Scores (Low Impact, High Effort)

Show how confident the tool is:

```json
{
  "success": true,
  "confidence": 0.98,
  "warnings": ["Found 2 dynamic requires that may need manual check"],
  "filesChanged": [...]
}
```

## 9. Related Actions (Medium Impact, Low Effort)

Suggest next steps:

```json
{
  "success": true,
  "message": "Renamed User to Customer in 47 files",
  "nextActions": [
    "organize_imports - Clean up after rename",
    "fix_all - Fix any type errors from rename"
  ]
}
```

## 10. Better Error Messages (High Impact, Low Effort)

Current:
```
"Rename failed: Cannot find symbol"
```

Better:
```
"❌ Cannot rename: Symbol 'User' not found at src/user.ts:10:5

💡 Try:
  1. Check the position (line:10, column:5)
  2. Use find_references to locate the symbol first
  3. Ensure the file is saved and TypeScript server is running"
```

## Priority Implementation Order

1. **Improve descriptions** (1-2 hours) - Immediate impact
2. **Add examples** (2-3 hours) - Big clarity boost
3. **Better error messages** (3-4 hours) - Reduces friction
4. **Related actions** (2-3 hours) - Guides usage
5. **Preview mode** (1-2 days) - Builds trust
6. **Batch operations** (2-3 days) - Power user feature
7. **Smart suggestions** (3-5 days) - Proactive assistance

## Success Metrics

- LLM chooses MCP tool over manual edit 80%+ of the time for:
  - Any rename operation
  - Any file move
  - Any import cleanup
  - Any type annotation addition
- Average time saved per refactoring: 5-30 minutes
- Error rate: <5% (vs 20-40% for manual edits)
