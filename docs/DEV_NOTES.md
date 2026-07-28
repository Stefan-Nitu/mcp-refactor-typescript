# Dev Notes

Recurring mistakes worth not repeating. Add an entry when a problem costs real time.

## Nothing may be resolved relative to `process.cwd()`

For an MCP server, `process.cwd()` is the *user's* project, not this package. Version
2.1.0 shipped with `resolve('node_modules/typescript/lib/tsserver.js')`
(`node:path`, cwd-relative) while `typescript` was only a devDependency, so a fresh
install had no tsserver to spawn. It worked on every developer machine because this
repo has its own `node_modules/typescript`.

Resolve this package's own files with `createRequire(import.meta.url)`, and the
project's files with `createRequire(join(projectPath, 'package.json'))`. See
`src/language-servers/typescript/resolve-tsserver-path.ts`.

## `Content-Length` from tsserver counts bytes, not characters

tsserver sizes each frame with `Buffer.byteLength(json, 'utf8')`. `MessageParser`
held its buffer as a decoded string and compared that byte count against
`string.length` (UTF-16 units), so the moment a response carried a non-ASCII
character the parser sat waiting for bytes that could never arrive as characters,
and the caller died on the 30s request timeout instead.

It looked like a tsserver problem because it was selective: `getApplicableRefactors`
returns short ASCII refactor names and always worked, while `getEditsForRefactor`
carries whole source files and failed on any project with an emoji or an em dash in
one. Keep `stdout` undecoded and keep the parser buffer a `Buffer`.

## A timer that reads `this.process` fires against whatever is there later

`stop()` armed a 2s force-kill that re-read `this.process` when it fired, and
never cleared it. A restart replaces `this.process` well inside that window, so
every restart SIGKILLed its own replacement about two seconds later. It read as
an intermittent flake only because whether an error surfaced depended on a
request being in flight at that moment; the kill itself happened every time.

Capture the child in a local and `clearTimeout` on exit. The same shape applies
to anything deferred that touches mutable instance state.

## Tests inside this repo cannot catch packaging bugs

`createTestDir()` puts workspaces at `<repo>/.test-workspace-*`, so Node resolution
walks up and finds this repo's `node_modules`. Every integration test therefore has a
TypeScript installed no matter what `package.json` declares. `bun run test:fresh-install`
packs the tarball and refactors a project in `os.tmpdir()` — that is the only test that
sees what users see.

## TypeScript 7 has no tsserver

`typescript@7` is the Go port: `lib/` has no `tsserver.js`, `bin` is only `tsc`, and
the exports map blocks the subpath. Its LSP advertises `quickfix`, `source.organizeImports`,
`source.removeUnusedImports`, `source.sortImports`, `source.fixAll` — and **no `refactor.*`
kinds**, so extract function/constant/variable, move-to-file and infer-return-type have no
equivalent there. The runtime dependency must stay on TypeScript 5.x; `resolveTsserverPath`
falls back to the bundled copy when a project is on 7.

## `tsr` pulls in TypeScript via a peer dependency

`tsr` declares `typescript: >=4.0.0` as a *peer*, so npm auto-installs the newest match —
that is how `typescript@7.0.2` landed in consumer installs. The direct `typescript: ~5.9.3`
dependency satisfies that peer range and dedupes to one copy; `test:fresh-install` asserts
the resolved version starts with `5.`.
