# QA Reports

## QA Report - 2026-07-28 14:42

Five parallel reviewers (code quality, security, patterns, testing, correctness) over the
uncommitted `move_to_file` bug-fix work. Every finding below was independently reproduced
before being acted on. Final state: **410 tests pass, 0 fail**, `bun run check` clean.

Two agent findings were **wrong and were rejected after verification** — see the last section.

### CRITICAL / HIGH — fixed

| Where | Defect | Resolution |
|---|---|---|
| `module-specifier-preference.ts` | Hand-rolled JSONC parser was quadratic on unterminated escaped-quote runs; 240 KB blocked the single-threaded server for 26.6 s | Deleted the parser. `ts.getParsedCommandLineOfConfigFile` via a lazy `import('typescript')` |
| `module-specifier-preference.ts` | `extends` fan-out bounded by depth but not breadth and no visited set — 2 entries × 16 deep = 65,535 reads in 3.9 s | Same deletion; the compiler handles cycles |
| `module-specifier-preference.ts` | `createRequire().resolve('/etc/passwd')` bypassed the `.json` constraint; a `*.json` symlink to `/dev/zero` never returned | Same deletion; resolution is the compiler's |
| `module-specifier-preference.ts` | `extends` array precedence inverted (any-wins vs TS's last-wins); bare package names (`@tsconfig/*`) silently dropped | Both now correct, each pinned by a unit test |
| `move-to-file.ts` | `importModuleSpecifierEnding` written to **global** host config and never reset — one package's answer leaked into every later operation on that server | `configureForFile` always sends `'js' \| 'auto'`. Guarded by a monorepo integration test, verified to fail without the fix |
| `message-parser.ts` | A malformed header wedged the parser permanently — every later frame returned `[]` and the buffer grew without bound | `resyncPast()` steps over a header that cannot parse |
| `message-parser.ts` | No cap on `contentLength`; `Content-Length: 99999999999999999999` buffered forever (200 MB and climbing) | `MAX_FRAME_BYTES`, then resync |
| `tsserver-client.ts` | `start()` never reset `projectLoaded`, so after a restart the readiness guard skipped its wait entirely | Reset on spawn; regression test added |
| `tsserver-client.ts` | The 500 ms `projectLoaded` timer was never cleared and gated on `running` — the same stale-timer bug just fixed in `stop()`, one function away | Captured child + `clearTimeout` in `stop()` |
| `tsserver-client.ts` | A half-read frame from a dead server would consume the replacement's first frames | Fresh `MessageParser` per spawn |

### MEDIUM / LOW — fixed

- `grouped-tools.ts`: `safeParse` ran **after** the registry lookup, so an out-of-enum operation
  threw instead of being explained. Now validates first; the test that pinned the throw was updated.
- `grouped-tools.ts`: a rejected call logged no terminal telemetry event, breaking the
  `tool_call` → outcome pairing. Now logs `tool_error`.
- `grouped-tools.ts`: `runOperation` took `(name, schema)`, duplicating each tool's identity across
  four call sites. Now takes the tool.
- `grouped-tools.ts`: `.describe()` existed only on `file_operations`. Added to `refactoring` and
  `workspace`, including that `deleteUnusedFiles` **deletes files** and needs `entrypoints`.
- `tool-input-shape.ts` (new): the `ZodEffects` unwrap was duplicated in `index.ts` and the tests,
  and handled exactly one level — a second `.refine()` would have registered a tool accepting
  anything. Now shared and looped.
- `edit-applicator.ts`: two zero-width insertions at an identical range came out reversed.
  Tie-break on original index.
- `message-parser.ts`: `Buffer.concat` per chunk was quadratic; `subarray` pinned the whole
  allocation. Now one join per frame, and the remainder is copied out.
- Test quality: replaced a tautological telemetry assertion (`expect(true).toBe(true)`), a
  non-guarding edit-order test that passed on the old comparator, and a non-discriminating
  `toContain('name')`; merged two 3 s sleeps in the restart suite.

### Coverage added

- `module-specifier-preference.unit.test.ts` (new, 11 tests) — the file had none.
- The `.refine()` rules for `refactoring`, `workspace` and `code_quality` now run at the protocol
  boundary **for the first time**; each is covered, including the `cleanup_codebase` delete guard.
- `ZodError` branch guards for the 7 operations that had none.
- Parser: header split across chunks, malformed-header recovery, implausible length.

### Not fixed — deliberate

- **`edit-applicator.ts` bounds check on `result[endLine]`** — pre-existing, unrelated to this
  change. Flagged, not touched.
- **15 copies of the 3-line `ZodError` catch across `src/operations/`** — mechanical and correct;
  collapsing it would touch 15 files for no behavioural change.
- **Overlapping-move race on the global ending preference** — fixing it needs file-scoped
  preferences, and `configure {file, preferences}` without `formatOptions` crashes the tsserver
  handler. Documented in the code instead.
- **`feed(Buffer | string)`** — production only passes `Buffer`; the string arm is for tests.

### Agent findings rejected after verification

- **"`extends: './configs'` should resolve to `./configs/tsconfig.json`"** (rated HIGH). Real `tsc`
  rejects it: `error TS6053: File './configs' not found.` Only *bare* specifiers get directory
  resolution. The test now pins the real behaviour.
- **"The restart test depends on cwd being the repo root"** (rated LOW). `projectInfo` resolves the
  config from the file's directory, not cwd. Verified by running the suite from `/tmp` — passes.
