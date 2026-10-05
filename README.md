[![NPM Version](https://img.shields.io/npm/v/mcp-refactor-typescript)](https://www.npmjs.com/package/mcp-refactor-typescript)
[![NPM Downloads](https://img.shields.io/npm/dm/mcp-refactor-typescript)](https://www.npmjs.com/package/mcp-refactor-typescript)
[![CI Status](https://github.com/Stefan-Nitu/mcp-refactor-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/Stefan-Nitu/mcp-refactor-typescript/actions/workflows/ci.yml)
[![MIT Licensed](https://img.shields.io/npm/l/mcp-refactor-typescript)](https://github.com/Stefan-Nitu/mcp-refactor-typescript/blob/main/LICENSE)

# MCP Refactor TypeScript

An MCP server that gives MCP clients TypeScript's own refactorings: rename symbols,
move files and declarations, extract functions and constants, organize imports and
apply quick fixes. It drives `tsserver`, the TypeScript language service editors use,
so TypeScript computes every edit; the server writes the edits to disk and reports each
one.

- Renames and moves update imports and references across the project.
- Every operation that edits files accepts `preview: true`, which returns the edits
  without writing them.
- Each response lists the changed files and every edit: line, column, old text, new text.

## Installation

```bash
npm install -g mcp-refactor-typescript
```

This installs the `mcp-refactor-typescript` command. You can also run the server
through `npx` without installing it (see Quick Start).

From source:

```bash
git clone https://github.com/Stefan-Nitu/mcp-refactor-typescript.git
cd mcp-refactor-typescript
bun install
bun run build
```

The server runs on Node.js 18 or later. Developing it needs Bun 1.3.8 or later.

### Which TypeScript it uses

Your project does not need TypeScript installed: the server ships TypeScript 5.9. When
a `typescript` package resolves from the directory the server was launched in, that
copy is used instead, so edits match the version the project compiles with; TypeScript
4.9 and later work. TypeScript 7 no longer ships `tsserver`, so a project on 7 gets the
bundled 5.9.

The project should have a `tsconfig.json`: tsserver uses it to know which files belong
to the project.

## Quick Start

### Claude Desktop

Add the server to Claude Desktop's configuration file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

If you installed it globally:

```json
{
  "mcpServers": {
    "mcp-refactor-typescript": {
      "command": "mcp-refactor-typescript"
    }
  }
}
```

Restart Claude Desktop to load it.

### MCP Inspector

Try the tools interactively in the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npx -y mcp-refactor-typescript
```

If you installed it globally:

```bash
npx @modelcontextprotocol/inspector mcp-refactor-typescript
```

The Inspector prints the URL to open in your browser.

To list the tools from the command line instead:

```bash
npx @modelcontextprotocol/inspector --cli npx mcp-refactor-typescript@latest --method tools/list --connect-timeout 60000
```

`--connect-timeout` gives `npx` time to download the package on the first run.

## Paths must be absolute

Every path parameter (`filePath`, `sourcePath`, `destinationPath`, each entry of `files`,
`targetFolder`, `directory`) must be an absolute path. A relative or empty path is
rejected with an error that names the parameter and the server's working directory.
A relative path would resolve against that directory, which is wherever the MCP
client launched it and not necessarily the checkout being edited: an agent working in
a git worktree would otherwise change the main checkout. `rename_file`'s `name` is a bare
filename and `entrypoints` are regex patterns, so neither is a path. Up to 2.3.0,
relative paths were accepted.

## Tools

The server exposes 4 tools covering 16 operations. The `operation` argument picks the
operation within a tool.

| Tool | Operations |
|------|------------|
| `file_operations` | `rename_file`, `move_file`, `batch_move_files` |
| `code_quality` | `organize_imports`, `fix_all`, `remove_unused` |
| `refactoring` | `rename`, `extract_function`, `extract_constant`, `extract_variable`, `move_to_file`, `infer_return_type` |
| `workspace` | `find_references`, `refactor_module`, `cleanup_codebase`, `restart_tsserver` |

### Operations

Operations that act on code take `filePath`, a 1-based `line` and `text`: the first
occurrence of `text` on that line that is not part of a longer identifier is the symbol
or expression to act on, so `user` never selects `username`. Every operation that
edits files also takes `preview`. `?` marks an optional parameter.

| Operation | Parameters | What it does |
|-----------|------------|--------------|
| `rename_file` | `sourcePath`, `name` | Renames a file in its directory (`name` is the new filename) and updates imports of it. |
| `move_file` | `sourcePath`, `destinationPath` | Moves a file to `destinationPath` (a full path including the filename) and updates imports. |
| `batch_move_files` | `files`, `targetFolder` | Moves each file into `targetFolder`, one at a time, updating imports. A file that fails is reported and the others still move. |
| `organize_imports` | `filePath` | Sorts the file's imports and removes unused ones. |
| `fix_all` | `filePath` | Gives each error in the file the one fix TypeScript prefers, in rounds until no fixable error is left, at most 10. A fix can edit other files. Like `remove_unused`, it keeps an unused declaration that may have side effects. |
| `remove_unused` | `filePath` | Removes unused imports, variables and functions, also under `noUnusedLocals` and `noUnusedParameters`. Keeps an unused declaration whose initializer may have side effects, such as `const server = app.listen(3000)`, and names it in the message. |
| `rename` | `filePath`, `line`, `text`, `name` | Renames a symbol and every reference to it. |
| `extract_function` | `filePath`, `line`, `text`, `name`? | Extracts `text` into a function, at module scope when TypeScript offers it. |
| `extract_constant` | `filePath`, `line`, `text`, `name`? | Extracts `text` into a `const` in the enclosing scope. |
| `extract_variable` | `filePath`, `line`, `text`, `name`? | Same edit as `extract_constant`: a `const` in the enclosing scope. |
| `move_to_file` | `filePath`, `line`, `text`, `destinationPath`? | Moves a top-level declaration to `destinationPath`, or to a new file named after it, and updates imports. |
| `infer_return_type` | `filePath`, `line`, `text` | Adds an explicit return type to a function. |
| `find_references` | `filePath`, `line`, `text` | Lists every reference to a symbol, grouped by file. Changes nothing. |
| `refactor_module` | `sourcePath`, `destinationPath` | `move_file`, then `organize_imports` and `fix_all` on the files the move touched, including the module at its new location. |
| `cleanup_codebase` | `directory`, `deleteUnusedFiles`?, `entrypoints`? | Runs `organize_imports` on every `.ts` and `.tsx` file under `directory`, skipping `node_modules`, `dist` and dot-directories. With `deleteUnusedFiles: true` it first runs [tsr](https://github.com/line/tsr), which removes unused exports and **deletes files** not reachable from `entrypoints`. |
| `restart_tsserver` | none | Stops tsserver and starts a new one. |

The extract operations generate a name when `name` is omitted. [docs/OPERATIONS.md](docs/OPERATIONS.md)
has examples for each operation; clients can also read it from the server as the
`operations://catalog` resource.

## Response Format

Every call returns one text item holding JSON:

```json
{
  "tool": "refactoring",
  "operation": "rename",
  "status": "success",
  "message": "Renamed to \"getUserProfile\"",
  "data": {
    "filesChanged": [
      {
        "file": "user.ts",
        "path": "/path/to/project/src/user.ts",
        "edits": [
          { "line": 1, "column": 17, "old": "getUser", "new": "getUserProfile" }
        ]
      },
      {
        "file": "main.ts",
        "path": "/path/to/project/src/main.ts",
        "edits": [
          { "line": 3, "column": 13, "old": "getUser", "new": "getUserProfile" },
          { "line": 1, "column": 10, "old": "getUser", "new": "getUserProfile" }
        ]
      }
    ],
    "nextActions": [
      "organize_imports - Clean up import statements",
      "fix_all - Fix any type errors from rename"
    ]
  }
}
```

- `status` is `"success"` or `"error"`. On `"error"` the MCP result also carries
  `isError: true`, which is what clients check.
- `message` summarizes the result. For `find_references` it is the result: the
  references, grouped under each file's absolute path.
- `data.filesChanged` has one entry per changed file: `file` is the file name, `path`
  the absolute path, and each edit gives the 1-based `line` and `column` in the file as
  it was before the operation, the `old` text and the `new` text. The exception is a
  `fix_all` that took more than one round: each round's edits refer to the text the
  rounds before it left. Within a file, edits are usually listed bottom-up, the order
  they are applied in. `filesChanged` is empty on failure and for operations that
  change nothing.
- `data.preview` appears only with `preview: true`:
  `{ "filesAffected": 2, "estimatedTime": "< 1s", "command": "Run again with preview: false to apply changes" }`.
  `estimatedTime` is a fixed estimate, not a measurement.
- `data.nextActions` appears when the operation suggests follow-up operations.

### Errors

A failed operation has the same shape with `"status": "error"` and an empty
`filesChanged`. The message says what failed and what to try:

```json
{
  "tool": "refactoring",
  "operation": "rename",
  "status": "error",
  "message": "Text \"getUsr\" not found on line 1\n\nLine content: export function getUser(id: string) {\n\nTry:\n  1. Check the text matches exactly (case-sensitive)\n  2. Ensure you're on the correct line",
  "data": { "filesChanged": [] }
}
```

Invalid input comes back in one of two forms, both with `isError: true`:

- A parameter of the wrong type, a relative path, an unknown `operation`, or a missing
  parameter that every operation of the tool needs is rejected by the MCP SDK before
  the server sees the call. The content is plain text, not JSON:
  `MCP error -32602: Input validation error: Invalid arguments for tool refactoring: Invalid input: expected number, received string at line`
- A parameter that only some operations need, such as `line` for `find_references`, is
  checked by the server and reported in the JSON shape above, with a message such as
  `"Invalid input:\n  • line is required for find_references\n\nCheck the input parameters and try again"`.

[docs/ERROR-HANDLING.md](docs/ERROR-HANDLING.md) covers every failure path.

## Examples

These are the `params` of an MCP `tools/call` request. Replace `/path/to/project` with
the absolute path of your project.

### Preview a rename

```json
{
  "name": "refactoring",
  "arguments": {
    "operation": "rename",
    "filePath": "/path/to/project/src/user.ts",
    "line": 10,
    "text": "getUser",
    "name": "getUserProfile",
    "preview": true
  }
}
```

The response lists the edits and nothing is written. Send it again without `preview`
to apply them.

### Extract a function

```json
{
  "name": "refactoring",
  "arguments": {
    "operation": "extract_function",
    "filePath": "/path/to/project/src/calculate.ts",
    "line": 15,
    "text": "x + y",
    "name": "addNumbers"
  }
}
```

`text` has to sit on the one `line`, so an extraction covers at most one line.

### Move a declaration to another file

```json
{
  "name": "refactoring",
  "arguments": {
    "operation": "move_to_file",
    "filePath": "/path/to/project/src/utils.ts",
    "line": 10,
    "text": "parseConfig",
    "destinationPath": "/path/to/project/src/config/parser.ts"
  }
}
```

### Move several files

```json
{
  "name": "file_operations",
  "arguments": {
    "operation": "batch_move_files",
    "files": [
      "/path/to/project/src/utils/string.ts",
      "/path/to/project/src/utils/number.ts"
    ],
    "targetFolder": "/path/to/project/src/lib"
  }
}
```

Each file keeps its name. The files move one after another, not as one transaction: if
one fails, the others still move and the message lists the failure.

### Delete unused files

```json
{
  "name": "workspace",
  "arguments": {
    "operation": "cleanup_codebase",
    "directory": "/path/to/project",
    "deleteUnusedFiles": true,
    "entrypoints": ["src/main\\.ts$", "src/cli\\.ts$", ".*\\.test\\.ts$"],
    "preview": true
  }
}
```

- With `deleteUnusedFiles: true`, `directory` must be the project root: the directory
  that contains the `tsconfig.json` tsr reads. The server refuses any other directory,
  because without that `tsconfig.json` tsr falls back to default compiler options and
  can judge files that are in use unreachable, then delete them.
- `entrypoints` is required with `deleteUnusedFiles: true`. Each entry is a regular
  expression matched against each file's absolute path (its real path, when the project
  is reached through a symlink); a file not reachable through imports from a matching
  file is deleted. Nothing imports a test file, so list your test files too.
- The server checks `entrypoints` before tsr runs: each must be a valid regular
  expression, and together they must match a source file other than a `.d.ts` among the
  files `tsconfig.json` includes. tsr also counts every `.d.ts` file as an entrypoint,
  so patterns that matched nothing else would leave it deleting everything those files
  do not import.
- The preview runs tsr without writing and reports what it would change, or that it
  found nothing to remove. Any tsr failure is reported as a failure.
- A real run that fails part-way is not rolled back: what tsr or the import sweep has
  already written or deleted stays that way.
- Without `deleteUnusedFiles`, the operation only organizes imports, and `directory`
  can be any directory.

## Development

### Layout

```
src/
├── index.ts                       MCP server: registers the tools and the operations://catalog resource
├── operation-name.ts              Operation names
├── registry.ts                    Builds every operation around one tsserver client
├── tools/                         The four tools and their input schemas
├── operations/                    One file per operation
│   └── shared/                    Edit application, file discovery, file moves, tsserver readiness, side-effect guard
├── language-servers/typescript/   tsserver client, message parser, tsserver lookup
├── resources/                     Serves docs/OPERATIONS.md
└── utils/                         Logger (stderr), telemetry, validation messages
scripts/fresh-install-smoke-test.mjs   Installs the packed server and refactors a project that has no TypeScript
```

### Commands

```bash
bun run build                # compile to dist/
bun run test                 # the whole suite; build first, two test files run dist/index.js
bun test --timeout 30000 src/operations/__tests__/rename.integration.test.ts   # one file
bun run check                # typecheck and lint
bun run test:fresh-install   # pack, install and run the server outside this repository
```

[docs/TESTING.md](docs/TESTING.md) explains the test layout and how to run subsets.

## Architecture

One tsserver process serves every call, and calls run one at a time: a call that
arrives while another is running waits for it to finish. The server starts tsserver at
launch when there are TypeScript or JavaScript files in its working directory or up to
two levels below it, and otherwise on the first call. Before each operation, the files
the server has open in tsserver are re-synced with the disk, so changes made outside
the server, in an editor or by git, are seen. An operation asks tsserver for edits,
applies them to the file contents itself and writes the files. Logs go to stderr;
stdout carries only the MCP protocol.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the details.

## Documentation

- [OPERATIONS.md](docs/OPERATIONS.md): what each operation does, with examples. Also served as the `operations://catalog` resource.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): how a tool call reaches tsserver, and how edits are computed and written.
- [ERROR-HANDLING.md](docs/ERROR-HANDLING.md): how failures are reported to clients.
- [TESTING.md](docs/TESTING.md): test layout, conventions and how to run the tests.
- [DEV_NOTES.md](docs/DEV_NOTES.md): past mistakes and the rules they left behind.
- [TDD.md](docs/TDD.md): the test-first workflow contributions follow.
- [MCP-TYPESCRIPT-README.md](docs/MCP-TYPESCRIPT-README.md): a copy of the MCP TypeScript SDK's README.

## Troubleshooting

### tsserver does not start

Operations fail with a message containing `Could not spawn tsserver at <path>: …` or
`tsserver at <path> exited with code …`. `<path>` shows which TypeScript the server
picked: the one that resolves from its working directory, or its bundled copy.

1. If `<path>` is in your project, check that project's TypeScript version: 4.9 and later work.
2. Set `LOG_LEVEL=debug` in the server's environment to log tsserver's stderr.
3. Call `restart_tsserver` to start a new tsserver.

### "TypeScript is still indexing the project"

tsserver had not reported the project as loaded within 5 seconds. Call the operation
again.

### A rename or find_references misses files

1. A rename's message ends with a warning when indexing had not finished or file
   discovery timed out. Run the operation again.
2. tsserver only sees files that belong to a project: make sure the files are covered
   by a `tsconfig.json`.
3. Call `restart_tsserver` after changing `tsconfig.json`.

### Imports are not updated after a move

1. tsserver updates `import` and `export` statements in the files it knows about (see
   above). It cannot follow a computed specifier such as ``import(`./${name}.js`)``.
2. Other string literals that hold the path, such as `vi.mock('./service.js')`,
   `jest.mock(...)` or `require(...)`, are matched as text, and only when written as a
   path relative to the file that ends in `.js`.

## Contributing

1. Fork the repository and create a branch.
2. Write a failing test first ([docs/TDD.md](docs/TDD.md)), then make it pass.
3. Run `bun run check`, then `bun run build` and `bun run test`.
4. Open a pull request.

## License

MIT. See [LICENSE](LICENSE).

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io): the MCP specification and documentation
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): the SDK this server uses
- [MCP Servers](https://github.com/modelcontextprotocol/servers): reference MCP server implementations
