# Error Handling

How the server reports failures to MCP clients, and the conventions failure messages
follow.

## How a failure reaches the client

Operations do not throw for failures they expect. Each one returns a `RefactorResult`
(defined in `src/language-servers/typescript/tsserver-client.ts`):

```ts
interface RefactorResult {
  success: boolean;
  message: string;
  filesChanged: Array<{
    file: string;
    path: string;
    edits: Array<{ line: number; column?: number; old: string; new: string }>;
  }>;
  nextActions?: string[];
  preview?: { filesAffected: number; estimatedTime: string; command: string };
}
```

A failure is `success: false` with a message and an empty `filesChanged`. Every
operation wraps its body in `try`/`catch`: a `ZodError` becomes a validation message
(below), and any other exception becomes `<Operation> failed: <error message>`, usually
followed by hints.

`src/index.ts` turns the result into the tool response:

| `RefactorResult` | JSON `status` | MCP `isError` |
|------------------|---------------|---------------|
| `success: true` | `"success"` | `false` |
| `success: false` | `"error"` | `true` |

The JSON carries `tool`, `operation`, `status`, `message` and `data.filesChanged`.
Clients should check `isError`: it is the MCP field for a failed call, while `status`
sits inside a text item the client has to parse. Before 2.3.0, `isError` was never set.

When something throws outside an operation's own `catch`, such as `runOperation`'s
`Operation not found`, `src/index.ts` catches it and returns `{ tool, operation, status:
"error", message }` without `data`, with `isError: true`. A `ZodError` caught there
comes back as `message: "Invalid input"` with an `errors` array of `{ path, message }`.
`runOperation` and the operations handle their own validation errors, so that branch is
a fallback.

## Validation errors

Input is checked in three places, and the first failure ends the call.

1. **The MCP SDK, against the tool's raw shape.** This catches wrong types, an
   `operation` outside the tool's enum, missing fields that every operation of the
   tool needs (`filePath` for `code_quality`; `filePath`, `line` and `text` for
   `refactoring`), and relative or empty paths: the absolute-path check sits on each
   path field, so it survives registration. The SDK answers without calling the
   server's handler, in plain text:

   ```
   MCP error -32602: Input validation error: Invalid arguments for tool code_quality: Invalid option: expected one of "organize_imports"|"fix_all"|"remove_unused" at operation
   ```

   A relative path names the parameter (`at filePath`, `at files[1]`) and the server's
   working directory:

   ```
   MCP error -32602: Input validation error: Invalid arguments for tool code_quality: Must be an absolute path. A relative path would resolve against the server's own working directory (/path/to/server/cwd), which may be a different checkout than the one you are working in. at filePath
   ```

2. **`runOperation`, against the full tool schema.** This catches the cross-field
   rules, fields that only some operations need: `name` for `rename`, `sourcePath` and
   `name` for `rename_file`, `line` for `find_references`, `entrypoints` when
   `deleteUnusedFiles` is true. `formatValidationError()` in
   `src/utils/validation-error.ts` turns the zod issues into a failed `RefactorResult`:

   ```json
   {
     "tool": "workspace",
     "operation": "find_references",
     "status": "error",
     "message": "Invalid input:\n  • line is required for find_references\n\nCheck the input parameters and try again",
     "data": { "filesChanged": [] }
   }
   ```

   An issue tied to a field is prefixed with the field's path, as in
   `files: At least one file must be provided`.

3. **The operation's own schema.** Each operation parses its input again with its own
   zod schema, which can be stricter than the tool's: `batch_move_files` needs at least
   one entry in `files`. The failure goes through `formatValidationError()` and looks
   the same as in (2).

## Operation failures

A call that passes validation can still fail:

- `text` is not on `line`, or appears there only inside a longer identifier
  (`Text "name" only appears as part of a longer identifier on line 2`), or `line` is
  past the end of the file.
- TypeScript offers no refactor at that position, or not the one asked for; the message
  then lists the refactors it does offer.
- A file cannot be read, reported as `<Operation> failed: ENOENT: …`.
- `cleanup_codebase` finds no `.ts` or `.tsx` file under `directory`. With
  `deleteUnusedFiles`, it also fails when `directory` is not the project root (the
  message names the nearest directory with a `tsconfig.json`), when an entrypoint is not
  a valid regular expression, when the entrypoints match no source file that
  `tsconfig.json` includes, or when tsr fails: its output is quoted, and a real run
  says tsr may have changed files before it stopped. tsr running past its 60-second
  timeout fails too.

Results that change nothing are successes: `No references found`,
`No import changes needed`, `No fixes needed`, `No auto-fixable errors found`,
`No unused code found`, `No unused code to remove`.

A `fix_all` that reaches its limit of 10 rounds succeeds with what it applied, and its
message says `stopped after 10 round(s) with fixable errors left; run fix_all again`.
`remove_unused` and `fix_all` name each unused declaration they kept because its
initializer or its assignments may have side effects: `Kept 1 unused declaration whose
initializer may have side effects: server (line 4)`. When nothing else was left to
change, the message starts `No unused code to remove` or `No auto-fixable errors
found`.

`batch_move_files` succeeds when at least one file moved, and its message lists the
files that failed (`Moved 2 file(s), 1 failed: …`). It fails only when no file moved.

`rename` and the file moves add a warning to a successful message when TypeScript was
still indexing or file discovery timed out. The result may then be incomplete, and
running the operation again is the fix.

### Partial writes

`rename`, `fix_all` and `move_to_file` compute every file before writing any, so a
failure while reading or computing leaves all files untouched. A failure while writing
is not rolled back. The file moves, the extract operations and `infer_return_type`
write each file as soon as it is computed, so a failure part-way can leave earlier
files written. So can `cleanup_codebase`: tsr writes and deletes files one at a time,
and the import sweep writes each file as it organizes it.

## tsserver failures

`TypeScriptServer` turns every tsserver problem into a rejected request, and the
operation's `catch` reports it as `<Operation> failed: <reason>`.

| What happened | Reason in the message |
|---------------|-----------------------|
| tsserver could not be spawned | `Could not spawn tsserver at <path>: <error>` |
| tsserver exited: it crashed or failed during startup | `tsserver at <path> exited with code <code>: <the error line from its stderr, if any>` |
| A request was sent after tsserver exited | `Cannot send <command>: tsserver is not running` |
| No response within 30 seconds | `Request <command> timed out` |
| tsserver answered `success: false` | The first line of tsserver's own message, such as `Error processing request. No Project.`, or `tsserver could not complete <command>` when it gives none |

- A spawn error or an exit rejects every pending request at once, rather than leaving
  them to time out, and marks tsserver as not running. Any request sent after that
  fails at once. The next operation's `TSServerGuard.ensureReady()` starts a new
  tsserver.
- A failed request's full message from tsserver, stack trace included, is logged at
  debug level.
- A failed start at launch is logged as `Failed to start tsserver` and the server keeps
  running; the first operation tries again.
- When the project has not finished loading within 5 seconds, `TSServerGuard` returns
  a failure instead of running the operation:

  ```
  ⏳ TypeScript is still indexing the project (waited 5000ms)

  💡 Try:
    1. Wait a few more seconds and try again
    2. For large projects, indexing can take 10-30 seconds
    3. Check that tsconfig.json is properly configured
  ```

- `restart_tsserver` reports `Failed to restart TypeScript server: <reason>`.

## The "Try:" convention

An operation's failure message is written for the model that made the call: what
failed, where, and what to do next.

```
Cannot rename: No symbol found for "getUser" at /path/to/project/src/user.ts:10

Try:
  1. Check that the text is a valid identifier
  2. Use find_references to verify the symbol exists
  3. Ensure the file is saved and TypeScript can analyze it
```

- The first line says what failed. It names the file and line (or `line:column`) when
  there is one, and for a caught exception it carries the exception's message
  (`Move file failed: ENOENT: …`).
- Then a blank line, `Try:`, and two to four numbered steps indented by two spaces.
  Steps name other operations when one helps (`Use find_references …`).
- When TypeScript offered refactors other than the one asked for, the message lists
  them (`Available refactorings: …`).
- `Try:` is the common form. A few messages use `Tips:`, `This might indicate:` or
  `This might happen if:` instead. New failure paths should use `Try:`.

Validation messages end with `Check the input parameters and try again` instead of a
list.

## Logging

- `runOperation` logs a `tool_error` telemetry event for every failed call: with
  `errorType: 'OperationFailed'` when the operation returns `success: false`, and the
  error's name when validation fails or the operation throws. Only a result with
  `success: true` is logged as `tool_success`.
- tsserver's exit is logged at `info` (`TSServer process exited`), and its stderr and
  the full message of a failed request at `debug`. Set `LOG_LEVEL=debug` to see why a
  tsserver or a request failed.
- An error during shutdown is logged and the process exits with code 1.

## Tests

- `src/language-servers/typescript/__tests__/tsserver-startup.unit.test.ts`: a tsserver
  that cannot start fails fast, with its path in the error.
- `src/language-servers/typescript/__tests__/request-timers.unit.test.ts`: request
  timers are cleared on reply and never hold the process open.
- `tsserver-exit.unit.test.ts` and `tsserver-error-message.unit.test.ts`, in the same
  directory: a request to a killed tsserver fails at once, and a failed request carries
  tsserver's reason without its stack trace.
- `src/operations/__tests__/validation.unit.test.ts` and
  `src/tools/__tests__/grouped-tools.unit.test.ts`: validation rules and messages,
  relative paths included.
- `src/tools/__tests__/grouped-tools.integration.test.ts`: a returned failure is logged
  as `tool_error`.
- `src/operations/__tests__/rename.integration.test.ts` and
  `move-to-file.integration.test.ts`: a failure part-way through writes nothing.
