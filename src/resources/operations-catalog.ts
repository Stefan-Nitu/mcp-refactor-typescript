/**
 * Operations Catalog Resource
 * Detailed documentation for all refactoring operations
 * Loaded on-demand, not included in tool descriptions
 */

export const operationsCatalog = `# TypeScript Refactoring Operations Catalog

## File Operations

### rename
**What**: TypeScript-aware symbol renaming with automatic import/export updates
**Time**: < 1s across entire codebase
**vs Edit**: Updates ALL references including dynamic imports, re-exports, type references
**vs grep/sed**: Compiler-aware, prevents breaking references

**Example**: Rename 'calculateSum' to 'computeSum'
\`\`\`typescript
Input: {
  operation: "rename",
  filePath: "src/math.ts",
  line: 5,
  text: "calculateSum",
  newName: "computeSum"
}

Result: Updates 47 references across 12 files:
  ✓ Function declaration
  ✓ All call sites: calculateSum(1, 2) → computeSum(1, 2)
  ✓ All imports: import { calculateSum } → import { computeSum }
  ✓ All exports and re-exports
  ✓ JSDoc references
\`\`\`

### move
**What**: Move file with automatic import path updates
**Time**: < 1s
**Safe**: All importing files automatically updated

**Example**: Move src/old/service.ts → src/new/service.ts
\`\`\`typescript
Input: {
  operation: "move",
  sourcePath: "src/old/service.ts",
  destinationPath: "src/new/service.ts"
}

Result: Updates all imports from '../old/service' to '../new/service'
\`\`\`

### batch_move
**What**: Move multiple files atomically with import updates
**Time**: < 2s for 10-20 files

**Example**: Reorganize utilities
\`\`\`typescript
Input: {
  operation: "batch_move",
  files: ["util1.ts", "util2.ts", "util3.ts"],
  targetFolder: "src/utils"
}

Result: Moves all files + updates all imports across codebase
\`\`\`

---

## Code Quality

### organize_imports
**What**: Sort imports alphabetically + remove unused imports
**Time**: < 500ms per file
**Safe**: Preserves side-effect imports

**Example**:
\`\`\`typescript
// Before
import { z } from 'unused';
import { c, a, b } from '../utils';
import './styles.css';

// After
import './styles.css';  // Side-effect preserved
import { a, b, c } from '../utils';  // Sorted, unused removed
\`\`\`

### fix_all
**What**: Apply ALL available TypeScript quick fixes
**Safe**: Only applies compiler-approved fixes

**Common fixes**:
- Add missing properties
- Fix type mismatches
- Convert to async/await
- Add missing imports
- Remove unused code

### remove_unused
**What**: Remove ALL unused variables and imports
**Safe**: Never removes side-effect code
**vs fix_all**: More aggressive, targets unused code specifically

---

## Refactoring

### extract_function
**What**: Extract code to function with auto-detected parameters and return types
**Magic**: Analyzes closures, mutations, control flow automatically

**Example**: Extract "const result = x + y" with name "addNumbers"
\`\`\`typescript
// Before
function calculate(x: number, y: number) {
  const result = x + y;
  return result * 2;
}

// After
function addNumbers(x: number, y: number): number {
  return x + y;
}

function calculate(x: number, y: number) {
  const result = addNumbers(x, y);
  return result * 2;
}
\`\`\`

Auto-detects:
- Parameters needed (x, y)
- Return type (number)
- Proper scope (module/function/block)
- Variable mutations

### extract_constant
**What**: Extract magic numbers/strings to named constants
**Scope**: Auto-detects optimal scope (module/function/block)

**Example**: Extract 3.14159 with name "PI"
\`\`\`typescript
// Before
const area = 3.14159 * radius * radius;
const circumference = 2 * 3.14159 * radius;

// After
const PI = 3.14159;
const area = PI * radius * radius;
const circumference = 2 * PI * radius;
\`\`\`

### extract_variable
**What**: Extract complex expressions to local variables
**Benefit**: Reduces duplication, improves readability

### infer_return_type
**What**: Generate perfect return type annotations automatically
**Benefit**: Even complex nested objects and union types - no guessing

**Example**:
\`\`\`typescript
// Before
function getData() {
  return { name: 'test', count: 42 };
}

// After
function getData(): { name: string; count: number } {
  return { name: 'test', count: 42 };
}
\`\`\`

---

## Workspace

### find_references
**What**: Find ALL usages with type-aware analysis
**vs grep**: Catches dynamic imports, re-exports, type-only imports, JSDoc refs

**Example**: Find references to 'helper' function
\`\`\`typescript
Found 3 reference(s) in 2 file(s):
utils.ts: Line 1: export function helper()...
main.ts: Line 1: const result = helper();
main.ts: Line 2: const another = helper();
\`\`\`

### refactor_module
**What**: Complete module refactoring workflow in one operation
**Steps**: Move file → Organize imports → Fix errors
**Time**: < 2s

**Example**: Move and clean up service.ts
\`\`\`typescript
Input: {
  operation: "refactor_module",
  sourcePath: "src/old/service.ts",
  destinationPath: "src/new/service.ts"
}

Performs:
1. Moves the file
2. Updates all import paths
3. Organizes imports in all affected files
4. Fixes any TypeScript errors
\`\`\`

### cleanup_codebase
**What**: Clean entire codebase - organize imports + optionally remove unused files
**Default**: Safe mode (organize imports only)
**Aggressive**: Set \`deleteUnusedFiles: true\` to remove unused exports/files

⚠️ **WARNING**: Aggressive mode DELETES files. Use preview mode first!

**Entry Points**: Files your app starts from (main.ts, index.ts, server.ts)
- Tool follows imports from entry points to find used code
- Anything not reachable = unused
- Test files automatically preserved

**Example**: Safe cleanup
\`\`\`typescript
Input: {
  operation: "cleanup_codebase",
  directory: "src"
}

Result:
- Organizes imports in all files
- Preserves all files and exports
- Skips node_modules and hidden directories
\`\`\`

**Example**: Aggressive cleanup
\`\`\`typescript
Input: {
  operation: "cleanup_codebase",
  directory: "src",
  deleteUnusedFiles: true,
  preview: true  // See what would be deleted
}

Result:
- Removes unused exports (via tsr)
- Deletes files with no used exports
- Organizes imports in remaining files
\`\`\`

### restart_tsserver
**What**: Restart TypeScript server to refresh project state
**Use when**: After tsconfig changes, dependency updates, or stale type info
**Time**: 5-10 seconds to restart + re-index

---

## Tips & Best Practices

### Always Use Preview Mode First
For destructive operations:
\`\`\`typescript
{ operation: "cleanup_codebase", directory: "src", deleteUnusedFiles: true, preview: true }
\`\`\`

### Verify Before Refactoring
Use find_references to understand impact:
\`\`\`typescript
{ operation: "find_references", filePath: "src/util.ts", line: 10, text: "helper" }
\`\`\`

### Chain Operations
Common workflows:
1. Rename → organize_imports → fix_all
2. Move → refactor_module (does organize + fix automatically)
3. Extract → organize_imports

### Performance Tips
- cleanup_codebase is expensive (scans entire project) - use on-demand
- find_references can take 5-10s on large codebases while indexing
- Most other operations complete in < 1s
`;
