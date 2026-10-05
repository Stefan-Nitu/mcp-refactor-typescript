# Architecture

mcp-refactor-typescript is an MCP server on stdio. It exposes four tools that together
cover 16 operations. All operations share one long-lived `tsserver` child process; they
apply the edits tsserver returns to the files on disk and report each edit.

## Request path

```
MCP client
  │  stdio (JSON-RPC)
  ▼
src/index.ts               McpServer + StdioServerTransport; builds the JSON response
  ▼
src/tools/grouped-tools.ts runOperation(): full-schema validation, telemetry
  ▼
src/registry.ts            OperationRegistry: operation name → operation
  ▼
src/operations/*.ts        one class per operation
  │  src/operations/shared/: readiness, file discovery, edits, file moves, side-effect guard
  ▼
src/language-servers/typescript/tsserver-client.ts   TypeScriptServer
  │  JSON requests on stdin, Content-Length frames on stdout
  ▼
tsserver (child process)
```

1. `src/index.ts` registers the four tools from `groupedTools` and the
   `operations://catalog` resource, then connects a `StdioServerTransport`. On every
   call, the MCP SDK first validates the arguments against the tool's raw shape: types,
   the `operation` enum, the fields every operation of that tool needs, and that each
   path is absolute, a check the path fields carry themselves. Only then does it call
   the server's handler.
2. The handler calls `runOperation` in `src/tools/grouped-tools.ts`. It logs a
   telemetry event and validates the arguments again, this time against the full
   schema. The cross-field rules in `.superRefine()` and `.refine()` (`line` is required
   for `find_references`, `entrypoints` with `deleteUnusedFiles`) do not survive
   registration, because `toolInputShape()` hands the SDK only the schema's field map.
3. `runOperation` looks up the operation in the `OperationRegistry` and calls
   `execute(args)` once the previous call has finished, however it finished. Calls run
   one at a time because every operation shares one tsserver and edits files, and
   `fix_all` hands tsserver text that is not on disk while it works; the MCP SDK starts
   calls as they arrive, and clients do send several at once. Operation names come
   from the `OperationName` enum in `src/operation-name.ts`.
4. The operation parses its own zod schema, checks that tsserver is ready, sends
   tsserver requests, computes the new file contents and writes them. It returns a
   `RefactorResult`: `{ success, message, filesChanged, preview?, nextActions? }`.
5. `src/index.ts` wraps the result as `{ tool, operation, status, message, data }` and
   sets the MCP `isError` flag when `success` is false. See
   [ERROR-HANDLING.md](ERROR-HANDLING.md).

`OperationRegistry` creates the single `TypeScriptServer` and builds every operation
with its dependencies through the factory functions in
`src/operations/shared/operation-factory.ts`. All operations share that one tsserver.

## The four tools

| Tool | Operations | `destructiveHint` |
|------|------------|-------------------|
| `file_operations` | `rename_file`, `move_file`, `batch_move_files` | false |
| `code_quality` | `organize_imports`, `fix_all`, `remove_unused` | false |
| `refactoring` | `rename`, `extract_function`, `extract_constant`, `extract_variable`, `move_to_file`, `infer_return_type` | false |
| `workspace` | `find_references`, `refactor_module`, `cleanup_codebase`, `restart_tsserver` | true (`cleanup_codebase` can delete files) |

`readOnlyHint` is false for all four. A client puts every tool's name, description and
input schema into the model's context, so grouping the operations behind an
`operation` enum keeps that list at four entries. The per-parameter `.describe()` texts
in the schemas are the parameter documentation a model receives. Longer documentation
lives in `docs/OPERATIONS.md`, which clients read only when they ask for it (see below).

## tsserver

### Which tsserver

`resolveTsserverPath(projectPath)` in `resolve-tsserver-path.ts` resolves
`typescript/lib/tsserver.js` with `createRequire` anchored at
`<projectPath>/package.json`, so it finds the TypeScript installed in or above that
directory. When none resolves, or the project's TypeScript has no tsserver
(TypeScript 7), it falls back to the copy this package depends on (`typescript`
`~5.9.3`). `projectPath` is always the server's working directory, `process.cwd()`. A
project's own TypeScript works back to at least 4.9.

### Starting and stopping

`TypeScriptServer.start(projectPath)` spawns `tsserver.js` with the Node binary that
runs the server (`process.execPath`), in `projectPath`, with piped stdio. It then sends a
`configure` request with editor preferences such as `allowTextChangesInNewFiles`.

- At launch, `OperationRegistry.initialize()` starts tsserver if a `.ts`, `.tsx`, `.js`,
  `.jsx`, `.mjs` or `.cjs` file exists in the working directory or up to two levels below
  it, skipping dot-directories, `node_modules`, `dist` and `build`. A failed start is
  logged and the server keeps running. `src/index.ts` awaits this before it connects the
  transport.
- Otherwise the first operation starts it: `TSServerGuard.ensureReady()` starts tsserver
  whenever it is not running, including after a crash.
- `restart_tsserver` stops the process and starts a new one.
- `stop()` sends SIGTERM and SIGKILLs the process if it has not exited after 2 seconds.

### Talking to it

- Each request is one line of JSON on tsserver's stdin with an increasing `seq`. A
  response is matched to its request by `request_seq`.
- `MessageParser` reads tsserver's stdout as `Content-Length` frames. The length counts
  bytes, so the buffer stays a `Buffer` until a frame is complete. A header that will
  not parse, or a frame larger than 128 MB, is skipped.
- A request fails after 30 seconds without a response. The timer is cleared when the
  reply arrives and is `unref`'d, so a pending request never keeps the process alive.
- A request to a tsserver that has exited, or was never started, fails at once with
  `Cannot send <command>: tsserver is not running`.
- When tsserver answers `success: false`, the request fails with the first line of
  tsserver's own `message`, such as `Error processing request. No Project.`; the rest
  is its stack trace. The whole message is logged at debug level. Without a message,
  the error is `tsserver could not complete <command>`.
- `open` and `close` are sent without waiting for a reply, because tsserver before 5.6
  does not answer them.
- A write error on tsserver's stdin, such as `EPIPE` as it dies, is logged at debug
  level; the exit that follows fails the pending requests.
- The `exit` and `error` events of a tsserver that a restart has already replaced are
  ignored.
- tsserver's stderr and its events are logged at debug level.

### Readiness

`TypeScriptServer` keeps a `projectLoaded` flag. The `projectLoadingFinish` and
`projectsUpdatedInBackground` events set it, and so does a timer 500 ms after start
when no such event has arrived. `TSServerGuard.ensureReady()` waits up to 5 seconds for
the flag; if it is still unset, the operation returns a failure asking to retry.

## Staying in sync with the disk

tsserver works on its own in-memory copy of every file the server opens, and never
re-reads an open file from disk. `openFile()` sends the file's contents as read from
disk and records its modification time and size. These keep tsserver's view current
and complete:

- `TSServerGuard.ensureReady()` runs before each operation, and before each step of a
  composite one, and calls `syncOpenFiles()`. It stats every open file, sends again
  each one whose modification time or size has changed, and closes each one deleted
  from disk. Changes made outside the server, by an editor or by git, and the previous
  operation's own writes are seen. An unchanged file costs one `stat`.
- `openFileWithContent()` sends tsserver text that is not on disk. `fix_all` uses it
  for the text each round of fixes leaves. Such a file is recorded as matching nothing
  on disk, so the next sync sends the disk contents back; `fix_all` also syncs when it
  finishes, so after a preview or a failure tsserver again holds what is on disk.
- `cleanup_codebase` closes each file after organizing it, so a sweep does not leave
  every file open for later syncs to `stat`.
- Starting tsserver, including a restart, forgets every open file: the new process has
  none.
- `FileDiscovery.discoverRelatedFiles()` runs before `rename`, `find_references` and the
  file moves. It opens the target files and every file tsserver reports as importing
  them (`fileReferences`). When tsserver reports none, it asks `projectInfo` for the
  project's `tsconfig.json` and file list, scans the `tsconfig.json`'s directory for
  source files the project does not list (skipping `node_modules`, dot-directories,
  `dist` and `.d.ts` files, for at most 5 seconds) and opens those too. When indexing had
  not finished or the scan timed out, `rename` and the file moves end their message
  with a warning.
- After a file move, `FileMover` closes the old path, opens the new one and reloads
  every file it edited, so the next move in `batch_move_files` is computed against the
  moved layout.

Path parameters are never resolved against the server's working directory: every one
must be absolute, and a relative path is rejected. The working directory is wherever
the client launched the server, which can be a different checkout (for example the main
checkout while an agent works in a git worktree).

## Computing and applying edits

- **Position.** `TextPositionConverter` turns `line` and `text` into a position: the
  first occurrence of `text` on that 1-based line that is not part of a longer
  identifier. An occurrence is skipped when an identifier character at its start or end
  runs into one next to it, so `user` does not match inside `username`. The selection
  covers exactly `text`, so it never spans lines.
- **Requests.** Each operation asks tsserver for edits:

  | Operation | tsserver requests |
  |-----------|-------------------|
  | `rename` | `rename` |
  | `find_references` | `references` |
  | `organize_imports` | `organizeImports` |
  | `fix_all` | `semanticDiagnosticsSync`, `getCodeFixes`, `getCombinedCodeFix` |
  | `remove_unused` | `suggestionDiagnosticsSync`, `semanticDiagnosticsSync`, `getCombinedCodeFix` (`unusedIdentifier_delete` and `unusedIdentifier_deleteImports`) |
  | `extract_*`, `infer_return_type`, `move_to_file` | `getApplicableRefactors`, `getEditsForRefactor` |
  | `rename_file`, `move_file`, `batch_move_files` | `getEditsForFileRename` |

- **Formatting.** Before the extract operations, `move_to_file` and `organize_imports`,
  `FormatConfigurator` detects the file's indentation and sends it to tsserver as
  `formatOptions`. `move_to_file` also sets `importModuleSpecifierEnding`: `js` when
  the project's `tsconfig.json` enables `allowImportingTsExtensions`, `auto` otherwise.
- **Applying.** tsserver returns `{ fileName, textChanges: [{ start, end, newText }] }`
  with 1-based lines and offsets. `FileOperations` reads a file as an array of lines.
  `EditApplicator.sortEdits()` orders the changes bottom-up (for equal starts, the wider
  range first), and `applyEdits()` splices them in, so each change's position is still
  valid when it is applied. `buildFileChanges()` records every change as
  `{ line, column, old, new }` against the original text; that is what the response
  reports in `filesChanged`.
- **fix_all rounds.** `fix_all` applies one fix per round. The fixes tsserver offers for
  an error are alternatives, the one it prefers first, and each error gets only that
  one. A round takes a fix family's combined fix (`getCombinedCodeFix`) when every
  error the family reaches prefers it and has had no fix yet; otherwise it takes the
  preferred fix of one error alone. The round applies it to the text the previous
  rounds left, sends the result with `openFileWithContent()` and asks for the
  diagnostics again. It stops when every error left either has no fix or has had its
  fix, or after 10 rounds, when the message says fixable errors are left. A preview
  runs the same rounds. Each round's edits are recorded against the text that round
  started from.
- **Kept declarations.** `src/operations/shared/side-effect-guard.ts` parses a file with
  the TypeScript compiler API and filters the edits of a fix for unused code. It keeps
  a declaration the fix would delete when its initializer may have side effects, or
  when an assignment to it that the fix would also delete may. It drops every
  edit to the declaration list or binding pattern holding a kept declaration, and to
  the statements that write to it, and reports each kept declaration for the message.
  `remove_unused` runs all its edits through it; `fix_all` runs the rounds whose fix is
  one of TypeScript's `unusedIdentifier` fixes, judged against the text the round
  started from. The compiler is this package's own TypeScript, loaded once on first use
  by `shared/typescript-compiler.ts`, the loader the `cleanup_codebase` entrypoint
  check and `move_to_file`'s reading of `tsconfig.json` also use.
- **Writing.** `rename`, `fix_all` and `move_to_file` read and compute every file before
  writing any, so a failure while reading or computing writes nothing. A failure during
  the writes is not rolled back. The file moves and the extract and
  `infer_return_type` operations write each file as soon as it is computed. With
  `preview: true` nothing is written and the same `filesChanged` comes back with a
  `preview` object.
- **Names.** The extract operations take the name TypeScript generates (`newFunction`,
  `newLocal`); when the call passes `name`, a follow-up `rename` request renames it and
  the files are written again.
- **File moves.** `FileMover` takes the import edits from `getEditsForFileRename`. In
  the files those edits touch, `StringLiteralPathUpdater` adds edits for string
  literals outside `import`/`export` lines that hold the old relative path (`vi.mock`,
  `jest.mock`, `require`). `FileMover` then writes the edited files, creates the
  destination directory and renames the file.
- **Composite operations.** `refactor_module` runs `move_file`, then `organize_imports`
  and `fix_all` on each file the move touched, including the moved module at its new
  location. `cleanup_codebase` runs `organize_imports` on every `.ts` and `.tsx` file
  under `directory`, skipping `node_modules`, `dist` and dot-directories, and closes
  each file after organizing it.
- **tsr.** With `deleteUnusedFiles: true`, `cleanup_codebase` first runs the `tsr` CLI
  this package depends on, with `process.execPath` through `execFile` (no shell), in
  `directory`, with a 60 second timeout. The entrypoints are joined with `|` and passed
  after `--`, so none is read as an option, and `NO_COLOR` is set so tsr's output
  carries no escape codes. `directory` must be the project root, the directory that
  holds the `tsconfig.json` tsr reads; without that file tsr uses default compiler
  options and can delete files that are in use. Before tsr runs, each entrypoint must
  compile as a regular expression, and the joined pattern must match a source file
  other than a `.d.ts` among the root files `tsconfig.json` defines, listed as tsr
  lists them: through `ts.parseJsonConfigFileContent`, from the real path of
  `directory`. tsr also counts every `.d.ts` file as an entrypoint, so patterns that
  matched nothing else would leave it tracing reachability from those files alone.
  A preview succeeds when tsr exits 0 (nothing to
  remove) or exits 1 after printing its `✖` summary; every other outcome, and any
  failure of a real run, is reported as a failure. A real run that fails part-way is
  not rolled back.

## Operations catalog resource

`src/resources/operations-catalog.ts` reads `docs/OPERATIONS.md` once, when the server
starts, from `../../docs/OPERATIONS.md` relative to the compiled module. `src/index.ts`
serves it as `operations://catalog` with MIME type `text/markdown`. The published
package has to include `docs/OPERATIONS.md`, and editing that file changes what clients
receive.

## Logging

- `src/utils/logger.ts` is a pino logger writing to stderr (file descriptor 2). Its
  level comes from `LOG_LEVEL`, default `info`. stdout carries nothing but MCP
  JSON-RPC; `src/__tests__/mcp-protocol.contract.test.ts` checks this against the
  built server.
- `src/utils/telemetry.ts` logs a `tool_call` event for every call that passes the
  SDK's validation. It follows with `tool_success` (`durationMs`, `filesAffected`) when
  the operation returns `success: true`, and `tool_error` otherwise: `errorType` is
  `OperationFailed` when the operation returns `success: false`, and the error's name
  when validation fails or the operation throws. These go to the same stderr log;
  nothing is sent anywhere else.

## Shutdown

SIGINT, SIGTERM, or the end of stdin (the client disconnecting) closes the MCP server,
stops tsserver and exits with code 0. If that takes more than 5 seconds, the process
exits with code 1.
