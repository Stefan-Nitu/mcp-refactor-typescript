# TypeScript Refactoring Operations Catalog

**Paths must be absolute**, e.g. `/path/to/project/src/service.ts`. The server rejects a
relative path: it would resolve against the server's own working directory, which is
wherever the MCP client launched it and can be a different checkout from the one being
edited, such as the main checkout while you work in a git worktree.

Operations that act on code take `filePath`, a 1-based `line` and `text`: the first
occurrence of `text` on that line that is not part of a longer identifier is the
target (`user` never selects `username`), so a selection never spans lines.
Every operation that edits files accepts `preview: true`, which returns the edits
without writing them.

Calls run one at a time: a call sent while another is running waits for it to finish.

## File Operations

### rename_file
**What**: Rename a file in its directory with automatic import path updates
**Safe**: All importing files automatically updated

**Example**: Rename service.ts to api-service.ts
```typescript
Input: {
  operation: "rename_file",
  sourcePath: "/path/to/project/src/service.ts",
  name: "api-service.ts"
}

Result: Updates all imports from './service.js' to './api-service.js'
```

`name` is a bare filename. To move a file to another directory, use move_file.

### move_file
**What**: Move file to different directory with automatic import path updates
**Safe**: All importing files automatically updated

**Example**: Move src/old/service.ts → src/new/service.ts
```typescript
Input: {
  operation: "move_file",
  sourcePath: "/path/to/project/src/old/service.ts",
  destinationPath: "/path/to/project/src/new/service.ts"
}

Result: Updates all imports from '../old/service.js' to '../new/service.js'
```

### batch_move_files
**What**: Move several files into one folder with import updates
**Not atomic**: Files move one at a time. A file that fails is reported and the others still move

**Example**: Reorganize utilities
```typescript
Input: {
  operation: "batch_move_files",
  files: [
    "/path/to/project/src/util1.ts",
    "/path/to/project/src/util2.ts",
    "/path/to/project/src/util3.ts"
  ],
  targetFolder: "/path/to/project/src/utils"
}

Result: Moves each file into src/utils under its own name + updates all imports across codebase
```

---

## Code Quality

### organize_imports
**What**: Sort imports + remove unused imports
**Safe**: Keeps side-effect imports

**Example**:
```typescript
// Before
import { z } from './unused.js';
import { c, a, b } from './abc.js';
import './styles.css';

// After
import { a, b, c } from './abc.js';  // Sorted, unused import removed
import './styles.css';               // Side-effect import kept
```

### fix_all
**What**: Apply the quick fix TypeScript prefers for each error in a file
**Scope**: A fix can edit other files, e.g. add `export` in the module that declares a name
**One fix per error**: Where TypeScript offers alternatives, such as importing an undefined name or declaring a stub for it, the error gets only the one TypeScript prefers
**Rounds**: Fixes are applied in rounds, each computed from the text the previous round left, until no fixable error is left. After 10 rounds it stops, and the message says fixable errors are left; run fix_all again to continue
**Preview**: Runs the same rounds and writes nothing
**Line numbers**: When the fixes took more than one round, a later round's edits refer to the text after the earlier rounds' edits, not to the original file
**Side effects**: The fixes for unused code, which TypeScript offers when `noUnusedLocals` or `noUnusedParameters` makes it an error, keep what remove_unused keeps, and also a variable whose assignments may have side effects (`handle = setInterval(…)`), along with those assignments. Each is named in the message, e.g. `Kept 1 unused declaration whose assignments may have side effects: handle (line 2)`

**Common fixes**:
- Export a declaration that another module imports (TS2459)
- Remove unused declarations when `noUnusedLocals` makes them errors

### remove_unused
**What**: Remove unused imports, variables and functions
**Strict options**: Also works when `noUnusedLocals` or `noUnusedParameters` makes unused code an error
**Imports**: Removes each unused import binding: a whole import, or one name of several
**Side effects**: Keeps an unused declaration whose initializer may have side effects (a call, `new`, `await`, `yield`, an assignment, `++`/`--`, `delete`, a tagged template) and names each one kept, e.g. `Kept 1 unused declaration whose initializer may have side effects: server (line 4)`. A destructured name's default or computed key counts too, and so does a private class property's initializer
**Removed whole**: A declaration inside something removed whole, such as an unused function, still goes with it

**Limits**:
- An unused declaration in the same statement or pattern as a kept one stays: `const a = f(), b = 1;` keeps `b`
- Unused code inside a kept declaration's initializer stays
- `import def, { a, b }` with only `def` used becomes `import def, {  } from …`
- An unused `using x = res;` is still deleted

---

## Refactoring

### rename
**What**: TypeScript-aware symbol renaming with automatic import/export updates
**vs Edit**: Updates every reference, including imports, re-exports and type references
**vs grep/sed**: Compiler-aware, prevents breaking references. Comments and strings are left alone

**Example**: Rename 'calculateSum' to 'computeSum'
```typescript
Input: {
  operation: "rename",
  filePath: "/path/to/project/src/math.ts",
  line: 5,
  text: "calculateSum",
  name: "computeSum"
}

Result: Updates every reference:
  ✓ Function declaration
  ✓ All call sites: calculateSum(1, 2) → computeSum(1, 2)
  ✓ All imports: import { calculateSum } → import { computeSum }
  ✓ All exports and re-exports
```

### extract_function
**What**: Extract code to a function with auto-detected parameters
**Placement**: At module scope, after the enclosing function, when TypeScript offers it
**Preview**: Shows TypeScript's generated name (`newFunction`); `name` is applied when the edit is written

**Example**: Extract "x + y" with name "addNumbers"
```typescript
Input: {
  operation: "extract_function",
  filePath: "/path/to/project/src/calculate.ts",
  line: 2,
  text: "x + y",
  name: "addNumbers"
}

// Before
export function calculate(x: number, y: number) {
  const result = x + y;
  return result * 2;
}

// After
export function calculate(x: number, y: number) {
  const result = addNumbers(x, y);
  return result * 2;
}

function addNumbers(x: number, y: number) {
  return x + y;
}
```

Auto-detects:
- Parameters needed (x, y) and their types
- Variables the extracted code changes

No return type is added; follow with infer_return_type if you want one.

### extract_constant
**What**: Extract a literal or expression to a named constant
**Scope**: The constant goes in the innermost enclosing scope, and only the selected occurrence is replaced
**Preview**: Shows TypeScript's generated name (`newLocal`); `name` is applied when the edit is written

**Example**: Extract 3.14159 with name "PI"
```typescript
Input: {
  operation: "extract_constant",
  filePath: "/path/to/project/src/circle.ts",
  line: 2,
  text: "3.14159",
  name: "PI"
}

// Before
export function measure(radius: number) {
  const area = 3.14159 * radius * radius;
  const circumference = 2 * 3.14159 * radius;
  return { area, circumference };
}

// After
export function measure(radius: number) {
  const PI = 3.14159;
  const area = PI * radius * radius;
  const circumference = 2 * 3.14159 * radius;
  return { area, circumference };
}
```

### extract_variable
**What**: Extract an expression to a local `const`
**Same as extract_constant**: Both write a `const` in the innermost enclosing scope

### move_to_file
**What**: Move a top-level symbol to another file with automatic import updates
**vs Edit**: Updates all imports/exports across the codebase automatically

**Example**: Move `parseConfig` to a dedicated file
```typescript
Input: {
  operation: "move_to_file",
  filePath: "/path/to/project/src/utils.ts",
  line: 10,
  text: "parseConfig",
  destinationPath: "/path/to/project/src/config/parser.ts"
}

Result: Moves parseConfig to new file + updates all imports:
  ✓ Moves the full declaration
  ✓ Creates destination file (with directory) if needed
  ✓ Updates all import paths across the codebase
  ✓ Carries over the imports the declaration needs
```

**Without destinationPath**: TypeScript creates a file named after the symbol, next to the source
```typescript
Input: {
  operation: "move_to_file",
  filePath: "/path/to/project/src/utils.ts",
  line: 10,
  text: "parseConfig"
}

Result: Moves parseConfig to a new file, src/parseConfig.ts
```

### infer_return_type
**What**: Add the return type TypeScript infers as an explicit annotation
**Benefit**: Spells out object and union types too

**Example**:
```typescript
Input: {
  operation: "infer_return_type",
  filePath: "/path/to/project/src/data.ts",
  line: 1,
  text: "getData"
}

// Before
export function getData() {
  return { name: 'test', count: 42 };
}

// After
export function getData(): { name: string; count: number; } {
  return { name: 'test', count: 42 };
}
```

---

## Workspace

### find_references
**What**: Find ALL usages with type-aware analysis
**vs grep**: Follows imports, re-exports and type-only imports, and skips unrelated text with the same name

**Example**: Find references to 'helper' function
```typescript
Input: {
  operation: "find_references",
  filePath: "/path/to/project/src/utils.ts",
  line: 1,
  text: "helper"
}

Result:
Found 3 reference(s) in 2 file(s):

/path/to/project/src/utils.ts:
  • Line 1: export function helper()...

/path/to/project/src/main.ts:
  • Line 1: const result = helper();
  • Line 2: const another = helper();
```

### refactor_module
**What**: Complete module refactoring workflow in one operation
**Steps**: Move file → Organize imports → Fix errors
**Preview**: Shows only the move's edits

**Example**: Move and clean up service.ts
```typescript
Input: {
  operation: "refactor_module",
  sourcePath: "/path/to/project/src/old/service.ts",
  destinationPath: "/path/to/project/src/new/service.ts"
}

Performs:
1. Moves the file
2. Updates all import paths
3. Organizes imports in every file the move touched, including the moved module at its new location
4. Runs fix_all on the same files
```

### cleanup_codebase
**What**: Clean a whole directory - organize imports + optionally remove unused exports and files
**Default**: Safe mode (organize imports only)
**Aggressive**: Set `deleteUnusedFiles: true` to remove unused exports and delete unused files (via tsr)

⚠️ **WARNING**: Aggressive mode DELETES files. Use preview mode first!

**Directory**:
- **Safe mode**: any directory. Every `.ts` and `.tsx` file under it is organized,
  except under `node_modules`, `dist` and dot-directories
- **Aggressive mode**: must be the project root, the directory that contains the
  `tsconfig.json` tsr reads. The server refuses any other directory: without that
  `tsconfig.json`, tsr uses default compiler options and can judge files that are in
  use unreachable, then delete them

**Entry Points**: Files your app starts from
- **Ignored in safe mode** (tsr does not run)
- **REQUIRED when `deleteUnusedFiles: true`**
- Regex patterns matched against each file's absolute path (the real path, when the project is reached through a symlink): `["src/main\\.ts$", "scripts/.*\\.ts$"]`
- tsr follows imports from entry points to find used code
- Anything not reachable = unused, and its file is deleted
- Nothing imports a test file, so add a pattern for your tests (`".*\\.test\\.ts$"`) or they are deleted
- Checked before tsr runs: each pattern must be a valid regex, and together they must match
  a source file other than a `.d.ts` among the files `tsconfig.json` includes. tsr counts
  every `.d.ts` file as an entry point too, so patterns that matched nothing else would
  leave it deleting everything those files do not import

**Example**: Safe cleanup
```typescript
Input: {
  operation: "cleanup_codebase",
  directory: "/path/to/project/src"
}

Result:
- Organizes imports in all files
- Preserves all files and exports
- Skips node_modules, dist and dot-directories
```

**Example**: Aggressive cleanup
```typescript
Input: {
  operation: "cleanup_codebase",
  directory: "/path/to/project",  // the project root, where tsconfig.json is
  deleteUnusedFiles: true,
  entrypoints: ["src/main\\.ts$", "src/cli\\.ts$", ".*\\.test\\.ts$"],  // REQUIRED with deleteUnusedFiles
  preview: true  // See what would be deleted
}

Result:
- Removes unused exports (via tsr)
- Deletes files not reachable from the entry points
- Organizes imports in remaining files
```

**Preview**: With `deleteUnusedFiles`, tsr runs without writing and the message carries
its report, or says it found nothing to remove. Without it, the preview only counts the
files and lists no edits.
**Failures**: Any tsr failure, its 60-second timeout included, is reported as a failure.
A real run that fails part-way is not rolled back: what tsr or the import sweep already
wrote or deleted stays that way.
**Large runs**: When more than 20 files change, `filesChanged` lists the first 20 with a
placeholder edit instead of their edits.

### restart_tsserver
**What**: Restart TypeScript server to refresh project state
**Use when**: After tsconfig changes, dependency updates, or stale type info

---

## Tips & Best Practices

### Always Use Preview Mode First
For destructive operations:
```typescript
{ operation: "cleanup_codebase", directory: "/path/to/project", deleteUnusedFiles: true, entrypoints: ["src/main\\.ts$"], preview: true }
```

### Verify Before Refactoring
Use find_references to understand impact:
```typescript
{ operation: "find_references", filePath: "/path/to/project/src/util.ts", line: 10, text: "helper" }
```

### Chain Operations
Common workflows:
1. Rename → organize_imports → fix_all
2. Move a module → refactor_module (moves, then organizes and fixes automatically)
3. Extract → organize_imports

### Performance Tips
- cleanup_codebase is expensive (organizes every file under the directory) - use on-demand
- rename and find_references open every file that imports the target before they run, which takes longer in a large codebase
