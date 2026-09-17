# Design: magento-cloud-package — `hiberus-magento-cloud` CLI and `hiberus-magento-cloud-mcp` server

> Size note: exceeds the 800-word budget for the same reason `eds-package` and
> `aco-package` did — the brief requires six separately-decided areas (the
> `mcp-core` field, the command layer, the `db:sql` guard, credential stripping,
> testing without a real CLI, conformance) each with rejected alternatives
> recorded. Tables carry the density. Every example value is synthetic.

## Technical Approach

`packages/magento-cloud` is scaffolded by `pnpm new-server magento-cloud` and
follows the architecture `eds` and `aco` established: the whole domain under
`src/client/`, whose only public surface is `client/index.ts`; `cli.ts` and
`mcp.ts` are adapters. The one difference reshapes everything below it:

> **This is the first package whose failure surface is a second process and a
> text contract, not a JSON envelope.** So the organising principle is: *every
> value that crosses into `execFile` is produced by exactly one function whose
> output type cannot be forged, and every value that comes back out is parsed by
> exactly one function that fails loudly and by name when the text drifts.*

`mcp-core`'s `validateArgv()` already supplies half of that for free: it is the
sole producer of the unforgeable `Argv` brand, it runs `argsSchema` before
`buildArgv`, and `buildArgv` is provably never called on a schema failure
(`exec.test.ts:137`). Every guard this package needs on the way *in* is therefore
placed **inside the spec's `argsSchema`**, not in a handler a future caller might
skip. Nothing new enforces it; the existing executor does.

---

## Decision 1: The `mcp-core` change — three production lines, and `process.env` becomes a type error

**Choice.** Two files, three production lines, zero removals.

```ts
// command-spec.ts — ONE added field. Values are named by the DOMAIN package.
readonly env?: Readonly<Record<string, string>>;

// run-allowlisted.ts — the options interface gains a REQUIRED, NARROWED field,
// exactly as it already narrows `stdio` (same file, lines 17-19).
interface AllowlistedExecOptions extends ExecFileOptions {
  readonly stdio: "pipe";
  readonly env: Readonly<Record<string, string>>;   // ← narrower than ExecFileOptions["env"]
}
//                       ...and the one changed line:
env: { ...spec.env },                                // was: env: {}
```

| Question from the brief | Answer, and the mechanism |
|---|---|
| Exact type, and how it reaches `execFile` | `Readonly<Record<string, string>>`, spread into a fresh mutable object at the single spawn site. Node receives a copy, never the caller's frozen record |
| A spec with **no** `env` | `{ ...undefined }` is `{}` — a new empty object literal, byte-identical to today. `exactOptionalPropertyTypes: true` (verified, `tsconfig.base.json:9`) means `env: undefined` is itself a tsc error, so "absent" has exactly one spelling |
| Can the type make `process.env` **unpassable**? | **Yes, for free.** `NodeJS.ProcessEnv` extends `Dict<string>`, whose index signature is `string \| undefined`. Under `strict: true` that is not assignable to `Record<string, string>`. So `env: process.env` and `env: { ...process.env }` are both **compile errors**, at the spec field *and* at the options interface. Cost: zero lines |
| How non-inheritance becomes **assertable** | Four layers, below. Layer 2 is the one that touches reality |

| # | Layer | Mechanism | What it proves | What it cannot |
|---|---|---|---|---|
| 1 | Type | `exec.test-d.ts`: `// @ts-expect-error` on `env: process.env` and on `env: { ...process.env }` | The wholesale form is unconstructible in any caller | Laundering (`Object.fromEntries(Object.entries(process.env)…)` yields `Record<string,string>`) |
| 2 | **Behaviour, real process** | Parent sets `MC_SENTINEL_<rand>`; the checked-in fake binary prints its own `Object.keys(process.env).sort()`; the test asserts the sentinel is **absent**, for a spec **with** `env` and a spec **without** | The child genuinely cannot see the parent's environment | Nothing — this is the real path |
| 2b | **Positive control for layer 2** | The same fake is spawned once via plain `execFile` with **no** `env` option, asserting the sentinel **IS** visible | That layer 2 is measuring something. Without this, a sentinel that never got set would pass silently — the exact fourth-disconnection shape | — |
| 3 | Source scan | `run-allowlisted.ts`, comments stripped (the `purity.test.ts:60` helper), contains no `process.env` token. The scanner's regex is first proven against a synthetic violating string, per the repo's own convention (`purity.test.ts:67`) | The file itself is clean regardless of type inference | Other files |
| 4 | Options readback | `expect(options.env).toEqual({})` and `Object.keys(options.env)` is empty for a no-`env` spec; exact key-set deep-equal for an `env`-carrying spec | Every existing caller is unchanged | That a real child honoured it — layer 2 does that |

**Diff size, exactly**: `command-spec.ts` +1 production line (+5 comment);
`run-allowlisted.ts` +1 production line, 1 changed (+2 comment). **Three
production lines across two files. Nothing removed.**

| Alternative | Why rejected |
|---|---|
| Package-local spawn wrapper in `packages/magento-cloud` (exploration's default) | Duplicates all five M4 invariants (`shell:false`, `stdio:"pipe"`, timeout, maxBuffer, `killSignal`) into a package that is not lint-boundaried for exec. Every future exec package copies them again, and a drift in one copy is invisible |
| An eslint `no-restricted-syntax` ban on `process.env` under `src/exec/**` | Verified hazard: that block already carries its own `no-restricted-syntax` array (regex/`.includes`/`.test` bans, `eslint.config.js:200-227`) and flat config merges same-named rules **last-match-wins, not by union** — the config's own comments document this bug class twice. A new block would silently delete the regex bans. Extending the array in place is possible, but the sentinel test must write `process.env.MC_SENTINEL_*` and lives under that same glob. **Trigger to revisit**: a second exec package, or a laundering form actually appearing in review |
| `env?: NodeJS.ProcessEnv` | Would make `env: process.env` legal. The whole safety property is that it is not |
| A `mergeEnv()` helper in `mcp-core` | A function is a place to put a bug. A spread at one site is not |

---

## Decision 2: Locating the binary, and three distinct failures — the `ENOENT` trap

**A verified trap, found by reading `run-allowlisted.ts:43`.** `exitCode = typeof
error.code === "number" ? error.code : 1`. For `ENOENT`, Node sets `error.code` to
the **string** `"ENOENT"`, so it collapses to `exitCode: 1` with empty stderr —
**indistinguishable from a generic failure through `CommandResult`.** A
not-installed binary cannot be classified after the fact.

**Choice: resolve before spawning.** `CommandSpec.bin` is already documented
"Resolved absolute at registration time" (`command-spec.ts:17`). So
`client/locate-binary.ts` walks an **injected** `pathEntries: readonly string[]`
(never `process.env.PATH` — `client/` is pure) and `accessSync(p, X_OK)`. Not
found → `MagentoCloudNotInstalledError` **before any process exists**. This
satisfies the existing `bin` contract, needs no `mcp-core` change, and is
testable by pointing `pathEntries` at the fake-bin directory.

| Failure | Detected | Confidence | Remedy |
|---|---|---|---|
| **Not installed** | Pre-spawn, `locateBinary()` returns none | `certain` | Names the binary and the install route from `docs/magento-cloud-onboarding.md` |
| **No credential** | Pre-spawn, `resolveCredentialValue({ domain: "magento-cloud", envVar: "MAGENTO_CLOUD_CLI_TOKEN" })` throws `MissingCredentialError` | `certain` | mcp-core's `formatRemedyMessage`, already caught by `defineTool.invoke` |
| **Not authenticated** | Post-spawn, non-zero exit + stderr matching the CLI's own non-interactive auth help / `Not logged in` | `heuristic` (aco precedent: a runtime field, not a comment) | Names `MAGENTO_CLOUD_CLI_TOKEN` and `hiberus-magento-cloud auth status`; correct under either reading |
| **Unsupported version** | `--version` spec, parsed once per process, memoized | `certain` when parsed, `unknown` when not | Names the minimum and the upgrade command |

`--version` unparseable → **do not fail**. Record `version: "unknown"`, surface it
in `auth status`, proceed. Refusing to run because a version string could not be
parsed is a worse failure than running. `MINIMUM_SUPPORTED_CLI_VERSION` is
**PROVISIONAL**: exploration found `VERSION = '5.3.1'` in the binary but could not
confirm it is the CLI's own version rather than a bundled dependency's. Confirm
during apply by running `--version` once; until then the check is warn-only.

`stdio: "pipe"` is unconditional in `runAllowlisted`, so the CLI's
`Input::isInteractive()` is always false and its interactive-login branch is
structurally unreachable. Inherited, not built.

---

## Decision 3: The allowlist — forbidden commands proven absent, not merely undeclared

Two `as const` literals in `client/commands.ts` are the only source of truth:

```ts
export const READ_ONLY_SUBCOMMANDS = [["auth:info","--no-auto-login"], ["project:list"], …] as const;
export const FORBIDDEN_SUBCOMMANDS = [["ssh"], ["environment:ssh"], ["environment:scp"],
  ["tunnel:list"], ["tunnel:open"], ["tunnel:close"], ["tunnel:info"], ["tunnel:single"],
  ["db:dump"], ["api:curl"], ["project:curl"], ["organization:curl"], ["environment:curl"], …] as const;
```

| Layer | Proof | Limit |
|---|---|---|
| Type | `commands.test-d.ts`: `Extract<ReadOnlyKey, ForbiddenKey>` is `never`. The two literal sets cannot overlap at compile time | Only covers what is written in these two literals |
| Unit | `listCommandKeys()` deep-equals `READ_ONLY_SUBCOMMANDS` mapped to keys, sorted; and for each forbidden entry `allowlist.resolve(bin, tokens)` is `undefined` | Tests the factory, not the bundle |
| Unit, **positive control** | `checkReadOnlyIsolation({ registeredCommandKeys: [...real, "<bin> db:dump"], expectedCommandKeys })` returns exactly one violation | Proves the checker is not a no-op — see Decision 9 |
| Artifact | `tools/list` on the built bundle returns exactly the eight tool names | Command keys are not on the wire; this is the closest bundle-layer proof and is stated as such |

`mcp-core`'s `FORBIDDEN_TOKENS` is untouched. It catches bare `ssh`/`tunnel`/`db:dump`
at registration; `tunnel:open` is not an exact token match and structurally cannot
be, which is fine — the executor is allowlist-based, so an unregistered command
does not exist. The tests above are what make that assertable in this domain.

---

## Decision 4: TSV — a quoting-aware parser, and what happens when the contract drifts

The CLI's `renderCsv($rows, $header, "\t")` delegates to a real `Csv` formatter, so
values containing tabs or newlines arrive **quoted**. Splitting on `\t` is wrong.

`client/tsv.ts` is a ~50-line character state machine (RFC4180 semantics, `\t`
delimiter): `"` opens/closes a field, `""` is a literal quote, delimiters and
newlines inside quotes are data. Row 1 is the header; rows are returned as
`Record<string, string>` **keyed by the header the CLI actually emitted** — never
positional indices, so a column reordering or an appended column is inert.

**Drift, which is certain.** Each parser module declares
`REQUIRED_HEADERS = [...] as const`. A missing required header throws
`MagentoCloudOutputShapeError` naming the subcommand, the missing header, the
headers actually seen, and the file to edit — the same loud-and-named shape as
`aco`'s `AcoSchemaMismatchError`. Unknown extra headers pass through untouched
(strict on our contract, tolerant on theirs — `aco` Decision 4's inversion).

**Honest limit: CI cannot detect drift**, because CI has no CLI. What detects it
is (a) the typed error at runtime, with the file to edit in the message, and (b) a
manual re-capture procedure in `docs/magento-cloud-onboarding.md` recording the
CLI version and date the canned fixtures were last refreshed. Stated rather than
papered over.

---

## Decision 5: `db:sql` — one lexer, four rules, two independent caps

**Placement, and why it cannot be skipped.** The guard is the `db:sql` spec's
`argsSchema`, as a zod `.transform()` producing a branded `GuardedQuery`:

```ts
declare const Guarded: unique symbol;                 // NOT exported — unforgeable
export type GuardedQuery = string & { readonly [Guarded]: true };

const dbSqlArgs = z.object({ projectId, environmentId, query: z.string(), maxRows: … })
  .strict()
  .transform((a, ctx) => ({ ...a, query: guardQuery(a.query, { rowCap: a.maxRows ?? ROW_CAP }, ctx) }));

buildArgv: (a) => ["db:sql", "--project", a.projectId, "--environment", a.environmentId,
                   "--raw", a.query];   //  ← parameter type carries GuardedQuery
```

`validateArgv()` runs `argsSchema.safeParse` **before** `buildArgv`, and
`exec.test.ts:137` already proves `buildArgv` is never reached on a schema
failure. So an unguarded query reaching `execFile` is not a review finding — it is
impossible without changing the spec's own schema. Rejected: guarding in the tool
handler (a future caller can skip it); rejected: guarding inside `buildArgv`
(`buildArgv` must return argv, so a rejection would have to throw past
`validateArgv`'s `Result` contract).

**One lexer, because `;`-splitting needs it anyway.** `client/sql/lex.ts` strips
`'…'` (with `\'` and `''`), `"…"`, `` `…` ``, `-- `/`#` line comments and `/*…*/`
blocks, and tracks paren depth. Every rule reads its output — a single source of
truth, so an evasion that defeats one rule defeats none of the others silently.

| # | Rule | Mechanism over the lexed form |
|---|---|---|
| 1 | Single statement, read-only verb | Split on **depth-0** `;` outside literals; more than one non-empty statement → reject. Leading verb ∈ `SELECT\|SHOW\|DESCRIBE\|DESC\|EXPLAIN`, else reject |
| 2 | **No `*` anywhere except `COUNT(*)`** | See below |
| 3 | File exfiltration | `INTO OUTFILE`, `INTO DUMPFILE`, `LOAD_FILE(` — one test per form |
| 4 | `LIMIT` | `SELECT` only. A **depth-0 trailing** `LIMIT n[,m]` / `LIMIT n OFFSET m` with `n > rowCap` → **reject**, naming the cap (clamping hides a caller's wrong assumption). Absent → append ` LIMIT <rowCap>` before `buildArgv` ever runs. Depth-0 tracking means a subquery's `LIMIT` is not mistaken for the statement's |

**Rule 2 — the `t.*` residual gap: CLOSED by over-rejecting, and the cost stated.**
The proposal permitted accepting it. A regex over the projection clause cannot
catch `t.*`, and scanning only the outer projection misses
`SELECT id FROM (SELECT t.* FROM big t) x`. So the rule is not a projection regex:
**after literal and comment stripping, reject any `*` in the statement that is not
the sole argument of `COUNT(`.** That rejects `SELECT *`, `SELECT DISTINCT *`,
`t.*`, and any `*` inside a subquery, with no SQL parser and no dependency.

- **Accepted cost, named**: arithmetic `SELECT a * b` is rejected. The message says
  so and says the two exits (name the columns, or use `COUNT(*)`). This is a
  deliberate **fail-closed** over-rejection, not an oversight.
- **Residual**: a `*` inside a string literal is stripped by design (`WHERE name = '*'`
  is correctly allowed) — a value, never a projection, so this is not a gap.
- **What would change the decision**: real diagnostic queries needing arithmetic
  `*` often enough that operators route around the guard. Then, and only then, a
  parser dependency is re-weighed against `dependencies: {}`.
- **Independent of rule 2 either way**: the injected `LIMIT` and `maxOutputBytes`
  bound the blast radius without reading the `*` scan's result at all.

**Two caps, because they have different failure domains.**

| Cap | Where it binds | What defeats it alone | Independent of |
|---|---|---|---|
| `LIMIT <rowCap>` | At the SQL engine, **before output exists** — protects the database and the SSH hop | One row containing a 10 MB blob | A bug in `maxOutputBytes` |
| `maxOutputBytes` (`maxBuffer`) | In this process, **after** bytes arrive — protects memory and the MCP frame | Nothing; it is a hard kill | A bug in the guard or the lexer |

A single cap cannot cover both, and neither substitutes for the other.
`SHOW`/`DESCRIBE`/`EXPLAIN` take no injected `LIMIT` (no meaningful one exists);
they are bounded by schema size and by `maxOutputBytes` alone — stated, not
implied.

**Which binds first, and what the caller is told.** `maxBuffer` overflow is an
**error, not truncation** — Node kills the child. So a byte-cap hit is a failed
call carrying `MagentoCloudOutputCapError` (cap value + "narrow the column list or
lower `maxRows`"), never a silently short result set. A row-cap hit is a **normal
success** whose result carries `{ rowCap, rowsReturned }`; `rowsReturned === rowCap`
is the caller's signal that more rows exist.

---

## Decision 6: `timedOut` disambiguation

> **Corrected during implementation.** This section originally stated as fact
> that Node uses the same `killSignal` for a `maxBuffer` overflow as for a
> wall-clock timeout, and built the disambiguation on that premise. A real
> child-process test on Node v22.14.0 disproved it
> (`packages/magento-cloud/src/client/classify.timeout.test.ts`): an overflow
> sets NEITHER `timedOut` NOR `error.killed`/`error.signal`.
>
> So classification cannot key off `timedOut`, and does not: it runs whenever
> `exitCode !== 0`, on the shared path all eight tools use. The conclusion
> below — disambiguate in-domain with an injected clock, no `mcp-core` change —
> stands; only its stated mechanism was wrong. Had the premise gone
> uncorrected, hitting the output cap would have reported as a generic failure
> instead of the explainable outcome it is.

`CommandResult.timedOut` is `killed && signal === "SIGKILL"`. Disambiguated
in-domain, with an injected clock, **no `mcp-core` change**, `timedOut`'s
meaning unchanged for existing callers:

```ts
const elapsedMs = now() - start;                       // injected clock, deterministic
// maxBuffer applies to stdout and stderr SEPARATELY, and counts BYTES — .length is
// wrong for multi-byte UTF-8. The 4-byte tolerance covers one split sequence.
const atByteCap = Math.max(byteLength(stdout), byteLength(stderr)) >= spec.maxOutputBytes - 4;
const atTimeBudget = elapsedMs >= spec.timeoutMs * TIME_ATTRIBUTION_FACTOR;  // 0.9, CHOSEN
```

| `atByteCap` | `atTimeBudget` | Classification | Message |
|---|---|---|---|
| yes | no | `output-cap-exceeded` | Names the byte cap and the narrow-the-query remedy |
| no | yes | `timed-out` | Names the time budget and the narrow-the-`WHERE` remedy |
| **yes** | **yes** | `resource-limit-exceeded` | **Names both causes and both remedies.** Asserting one would be asserting a wrong cause half the time |
| no | no | `killed-unclassified` | Names both, and says the cause could not be attributed |

`TIME_ATTRIBUTION_FACTOR = 0.9` is **chosen, not derived** — elapsed is measured
around the promise and includes spawn overhead, so a byte-cap kill at 0.95× the
budget would otherwise be misattributed. Ambiguity is reported, never guessed.
Two tests whose **only** difference is which limit the fake binary exceeds.

---

## Decision 7: Credential stripping at the client boundary

`environment:relationships` carries live service credentials. Stripping is not a
formatting step — it is **the shape of the only exported type**.

```ts
// client/relationships.ts — RawRelationship is module-private. It is never
// returned, never stored on a result, never attached to an error's `cause`.
export interface ServiceEndpoint {
  readonly service: string; readonly scheme: string;
  readonly host: string;    readonly port: number;
}   // ← four fields. There is nowhere to put a username or a password.
```

Construction *is* the stripping: the parser builds `ServiceEndpoint` field by
field from named keys. There is no `{ ...raw }` anywhere in the module, and a
source-scan test asserts that.

The CLI needs the raw payload. It gets `getRawRelationshipsText(): CliOnlyText` —
a **branded opaque string**, the unparsed stdout, deliberately *not* a typed
object, so nothing can reach a `password` field through a shared type.

| Layer | Proof | Limit |
|---|---|---|
| Type | `ServiceEndpoint` has four fields; `client/index.ts` exports no type carrying `username`/`password` | Cannot stop `mcp.ts` importing the raw function |
| Source scan | No file under `src/tools/**` references `getRawRelationshipsText`; no `{ ...raw }` in `relationships.ts` | Covers what the type cannot |
| **Behaviour, against the real fixture** | The `serviceEndpoints` tool result is **serialized** and asserted to contain neither the fixture's username nor its password value, and no key matching `/user\|pass\|secret\|token/i`. The fixture is **the same canned file the fake binary emits** (Decision 8) — not a hand-built object | — |

That last row is the point: the assertion runs on the serialized text an agent
actually receives, fed by the same bytes the real path produces.

---

## Decision 8: Testing without a CLI, an account, or a network — one fixture corpus, two consumers

**The rule that answers the fourth-disconnection pattern.** Three mechanisms in
this programme passed unit tests while disconnected from reality, because the
tests fed the function the input it *expected* rather than the input it *gets*.
So:

> **`test/fake-bin/fixtures/*.txt` is the single corpus. The fake binary reads it
> to produce stdout, and the mocked unit tests import the same files as their
> `execFile` stdout.** A unit test physically cannot be fed a shape the real path
> never produces, and a fixture edit changes both tiers at once.

| Tier | Mechanism | Proves | Cannot prove |
|---|---|---|---|
| Unit | `vi.mock("node:child_process")`, stdout read from the corpus. Asserts exact `argv` **and** exact `env` key set | Argv building, `LIMIT` injection, `*`/verb/exfil rejections (asserting `execFile` was **never called**), env assembly, parsing | That a process ever ran |
| Real process | Executable `test/fake-bin/magento-cloud` (`#!/usr/bin/env node`), located by `locateBinary({ pathEntries: [fakeBinDir] })` | A real spawn, the real env map arriving, real piping, real timeout/byte-cap kills, fd-1 isolation | That the **real** CLI accepts this argv or still emits this shape |

The fake matches on joined argv → fixture file. **Unknown argv exits 2 with the
argv echoed on stderr**, so a drifted argv builder fails loudly instead of
returning empty. Special argv: `__env-probe` prints `Object.keys(process.env).sort()`
(Decision 1 layer 2); `__slow` sleeps past the timeout; `__flood` writes past
`maxOutputBytes` (Decision 6's two tests).

**The executable bit is itself tested**: `statSync(fakeBin).mode & 0o111` is
non-zero, so a clone or a patch that loses mode `100755` fails loudly rather than
turning every real-process test into an `ENOENT` nobody reads.

**What neither tier can prove**, stated plainly: that the real CLI accepts these
argv shapes, that its output is still this shape, that authentication works, that
MySQL honours the injected `LIMIT`. The compensating control is a **manual
acceptance checklist** in `docs/magento-cloud-onboarding.md`, run once by a human
against the real CLI before publish, recording the CLI version and the date. It is
a human gate, named as one — not a test pretending to be one.

**Every guard is proven to FAIL, not only to pass**, following the repo's own
existing convention (`aco/src/client/purity.test.ts:67`, which proves each regex
against a synthetic violating string before pointing it at real source):

| Guard | How it is proven to fail |
|---|---|
| Env non-inheritance | Positive control: plain `execFile`, no `env` option → sentinel **IS** visible |
| `*` / verb / exfil rejections | A crafted evasion per rule (`t.*`, `SeLeCt *`, `/*c*/SELECT *`, `'a;b'` as a value, `LIMIT` in a subquery) is asserted **rejected**, and `execFile` asserted **never called** |
| `LIMIT` injection | A `SELECT` with no `LIMIT` is asserted to reach `execFile` **with** `LIMIT <rowCap>` in the captured argv — the argv, not the return value |
| Credential stripping | The fixture's relationships payload **contains** a username and a password; the assertion is on the serialized result |
| Forbidden-command absence | `checkReadOnlyIsolation` fed a contaminated key list returns exactly one violation |
| TSV parser | Round-trips a value with an embedded tab **and** one with an embedded newline without splitting the row; a naive `split("\t")` control is shown to produce the wrong row count |
| Source scanners | Each regex matches a synthetic violating string before scanning real source |
| Fake-binary wiring | Unknown argv exits 2 — asserted, so a silent-empty fake is impossible |

---

## Decision 9: Conformance — the first real caller of `shellOutProbe` and `readOnlyIntrospections`

**`shellOutProbe`.** `magentocloud_auth_status` is the probe tool: it is the one
tool that deliberately **tolerates an absent credential** (reporting
`authenticated: false` is its entire job), so it needs no secret to run, and it
genuinely shells out.

**The wiring problem, verified rather than assumed.** `describeConformance`
constructs `JsonRpcClient` with no `env` (`conformance.ts:207`), and
`JsonRpcClient` falls back to `sanitizedEnv()`, which forwards **`PATH` only**
(`jsonrpc-client.ts:44-50`). So the built server can be handed the fake binary
**only through `PATH`** — and `sanitizedEnv()` reads `process.env.PATH` lazily
inside the constructor. The conformance test therefore prepends the fake-bin
directory to its own `process.env.PATH` at module scope, before
`describeConformance(...)` runs, and restores it in a file-level `afterAll`.

| Alternative | Why rejected |
|---|---|
| Add `serverEnv` to `ConformanceOptions` | An `mcp-conformance` requirement change the proposal explicitly excludes. **Trigger to revisit**: a second package needing a non-`PATH` variable |
| A `MAGENTO_CLOUD_BIN` override env var | Cannot reach the spawned server — `sanitizedEnv()` forwards `PATH` and nothing else. The mechanism would not work, which is exactly the class of bug this change exists to stop repeating |
| Ship a decorative `read-echo` tool | The suite already documents that a package must not ship one just to satisfy the probe |

**`expectedResultText` is derived from the corpus.** The probe asserts
`result.content[0].text` equals the exact text the fake's canned `auth:info`
fixture produces. **A tool that did not spawn a child could not produce that
text** — so a passing probe is positive evidence that a real child process ran and
its stdout was captured, which is precisely what change 2 added the option for.

**`readOnlyIntrospections`** is fed from `createMagentoCloudAllowlist(...).listCommandKeys()`
constructed **in the test process**, since the allowlist lives in the server
process. Limit stated honestly: this is a source-layer proof wearing a conformance
hat. Its teeth come from the positive control in Decision 3; the bundle-layer
proof of "no mutating operation is reachable" is the exact eight-name
`tools/list` assertion.

---

## Data Flow

```
  MCP client (8 tools)                         CLI operator (raw relationships, auth)
      │ tools/call                                   │ argv — never a token
      ▼                                              ▼
  mcp.ts → tools/magento-cloud-tools.ts         cli.ts   (stdout, exit codes, redaction)
   zod .strict() = the wire gate                      │
                    │                                 │
                    ▼                                 ▼
   ┌──────────────────────── client/index.ts ─────────────────────────┐
   │                    (the only public surface)                     │
   │                                                                  │
   │  locate-binary.ts ──► absolute bin  (NOT FOUND → NotInstalled)   │
   │  credential-provider.ts ──► token   (ABSENT → MissingCredential) │
   │  child-env.ts ──► { MAGENTO_CLOUD_CLI_TOKEN, HOME, PATH }        │
   │        │                       ▲ named keys only, never spread   │
   │        ▼                                                         │
   │  commands.ts  CommandAllowlist.register(spec)   spec.env ────────┼──┐
   │        │                                                         │  │
   │        ▼                                                         │  │
   │  validateArgv(spec, raw)  ── argsSchema ─► guardQuery (db:sql)   │  │
   │        │  schema-invalid ──► rejected, buildArgv NEVER called    │  │
   │        ▼                                                         │  │
   │      Argv (unforgeable)                                          │  │
   └──────────────────────────────────┬───────────────────────────────┘  │
                                      ▼                                  │
                      mcp-core runAllowlisted(spec, argv) ◄──────────────┘
                      shell:false  stdio:"pipe"  env:{...spec.env}
                                      │
                       ┌──────────────┴───────────────┐
                  CommandResult                    spawn error
                       │                                │
              classify(elapsed, bytes)          (unreachable: ENOENT
                       │                         pre-empted by locate)
        ┌──────────────┼──────────────┬────────────────┐
   output-cap       timed-out    resource-limit    exit 0
                                                       │
                                              tsv.ts (quote-aware)
                                                       │
                                     REQUIRED_HEADERS present?
                                        no ──► OutputShapeError (named, with file to edit)
                                        yes ─► relationships.ts strips user/password
                                                       │
                                               ServiceEndpoint[4 fields]
```

### Sequence: `magentocloud_query_database` with a `SELECT` carrying no `LIMIT`

```
 agent    tools/*        validateArgv      guardQuery/lex      runAllowlisted    fake/real CLI
   │         │                │                  │                   │                │
   │─ call ─►│                │                  │                   │                │
   │         │ resolve token ─┤ absent ──► MissingCredentialError ✗ no spawn          │
   │         │ locate bin ────┤ absent ──► NotInstalledError        ✗ no spawn        │
   │         │───────────────►│                  │                   │                │
   │         │                │ argsSchema.safeParse                 │                │
   │         │                │─────────────────►│ strip literals/comments            │
   │         │                │                  │ depth-0 ';' split → 1 stmt         │
   │         │                │                  │ verb = SELECT                      │
   │         │                │                  │ '*' outside COUNT(*) ? ──► reject ✗ (execFile never called)
   │         │                │                  │ INTO OUTFILE/LOAD_FILE( ? ─► reject ✗
   │         │                │                  │ depth-0 trailing LIMIT? none       │
   │         │                │                  │ append " LIMIT <rowCap>"           │
   │         │                │◄─ GuardedQuery ──│                   │                │
   │         │                │ buildArgv(...)   │                   │                │
   │         │                │──── Argv ────────┼──────────────────►│                │
   │         │                │                  │   env:{TOKEN,HOME,PATH} only ─────►│
   │         │                │                  │                   │◄── TSV stdout ─│
   │         │                │      classify(elapsed, byteLength)   │                │
   │         │◄─ rows + { rowCap, rowsReturned } ─┴───────────────────┘                │
   │◄ result │   rowsReturned === rowCap ⇒ more rows exist                             │
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mcp-core/src/exec/command-spec.ts` | Modify | **+1 production line**: `readonly env?: Readonly<Record<string, string>>` |
| `packages/mcp-core/src/exec/run-allowlisted.ts` | Modify | **+1, ~1**: required narrowed `env` on `AllowlistedExecOptions`; `env: { ...spec.env }` |
| `packages/mcp-core/src/exec/exec.test.ts` | Modify | No-`env` readback; exact key-set readback; source scan (comment-stripped) |
| `packages/mcp-core/src/exec/exec.test-d.ts` | Create | `@ts-expect-error` on `env: process.env` and `env: { ...process.env }` |
| `packages/mcp-core/src/exec/run-allowlisted.env.test.ts` | Create | Real-process sentinel test **and its positive control** |
| `packages/magento-cloud/src/client/{index,commands,locate-binary,child-env,tsv,relationships,errors,classify}.ts` | Create | Allowlist + argv builders, binary resolution, env assembly, TSV, stripping, error hierarchy, timeout/cap classification |
| `packages/magento-cloud/src/client/sql/{lex,guard}.ts` | Create | The lexer and the four-rule guard producing `GuardedQuery` |
| `packages/magento-cloud/src/client/parsers/*.ts` | Create | Per-subcommand `REQUIRED_HEADERS` + row mappers |
| `packages/magento-cloud/src/credential-provider.ts` | Create | `resolveCredentialValue` wiring, `MissingCredentialError` remedy |
| `packages/magento-cloud/src/cli.ts`, `src/mcp.ts`, `src/tools/magento-cloud-tools.ts` | Create | Adapters; eight `defineTool()` registrations |
| `packages/magento-cloud/test/fake-bin/magento-cloud` | Create | Executable (mode `100755`) Node script; `__env-probe`/`__slow`/`__flood`; unknown argv exits 2 |
| `packages/magento-cloud/test/fake-bin/fixtures/*.txt` | Create | **The single corpus** — canned TSV and error text, read by the fake *and* by the mocked unit tests |
| `packages/magento-cloud/src/**/*.test.ts`, `*.test-d.ts` | Create | Strict-TDD suite, every RED first |
| `packages/magento-cloud/src/mcp.conformance.test.ts` | Create | `shellOutProbe` + `readOnlyIntrospections`; PATH prepend and restore |
| `packages/magento-cloud/eslint-fixtures/deep-client-import.ts` | Create | Proves the client-boundary rule fires here |
| `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` | Modify | Additive synthetic project/environment/token constants |
| `servers.json`, `README.md`, `openspec/config.yaml` | Modify | `magento-cloud` entry with `"magento-cloud"` in `requires.binaries`; README regenerated; `testing.projects` |
| `docs/magento-cloud-onboarding.md` | Create | Token/install steps, the fixture re-capture procedure, the manual acceptance checklist |

---

## Interfaces

```ts
// packages/mcp-testing/src/fixtures/synthetic-identifiers.ts — additive.
export const SYNTHETIC_MC_PROJECT_ID = "mcproj-demo-0001" as const;
export const SYNTHETIC_MC_ENVIRONMENT_IDS = ["demo-production", "demo-staging"] as const;
export const SYNTHETIC_MC_TOKEN = "mc-demo-token-not-a-real-credential" as const;
export const SYNTHETIC_MC_HOST = `demo-host.${SYNTHETIC_DOMAIN}` as const;   // → demo-host.example-domain

// packages/magento-cloud/src/client/child-env.ts — named keys, never a spread.
export function buildChildEnv(input: {
  readonly token?: string;        // absent ⇒ auth_status only (Decision 9)
  readonly home: string;          // injected by the adapter, never read here
  readonly path: string;
}): Readonly<Record<string, string>>;   // key set is asserted exactly, in both test tiers
```

---

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Type | `env: process.env` and `env: { ...process.env }` rejected; `Extract<ReadOnlyKey, ForbiddenKey>` is `never`; `buildArgv` cannot take a raw string query | `*.test-d.ts` under `vitest --typecheck` |
| Unit — exec | No-`env` spec spawns with exactly `{}`; `env` spec's key set deep-equals `["HOME","MAGENTO_CLOUD_CLI_TOKEN","PATH"]`; every existing exec test passes unchanged | Captured `execFile` options |
| Real process — exec | Parent sentinel invisible to the child (with and without `env`); **positive control** shows it visible when inheriting | Fake binary `__env-probe` |
| Unit — SQL guard | One test per rule plus one crafted evasion per rule; every rejection asserts `execFile` **never called**; the no-`LIMIT` case asserts the **captured argv** carries `LIMIT <rowCap>`; explicit over-cap `LIMIT` rejected with the cap in the message | Table-driven over the lexer |
| Unit — TSV | Embedded tab and embedded newline round-trip; naive-split control produces a different row count; missing required header throws naming subcommand + header + headers seen | Corpus fixtures |
| Unit — classification | Byte cap vs wall clock: two tests differing only in which limit the fake exceeds; the both-hold case names both remedies | `__slow` / `__flood` |
| Unit — stripping | Serialized `serviceEndpoints` result contains neither fixture credential and no `/user\|pass\|secret\|token/i` key | Corpus relationships fixture |
| Unit — allowlist | Registered key set deep-equals the literal; 13 named forbidden entries resolve `undefined`; `checkReadOnlyIsolation` positive control | `listCommandKeys()` |
| Unit — purity/structure | No `console.`/`process.exit`/`process.env`/prompt/ANSI under `client/`; no `getRawRelationshipsText` under `tools/`; no `{ ...raw }` in `relationships.ts`; fake binary mode is executable | Source scans, each regex proven against a synthetic violation first |
| Runtime — tools | Exactly the eight names; `db:sql` with absent `query` rejected; `magentocloud_auth_status` succeeds with **no** credential | `safeParse` + `invoke()` |
| Conformance | `describeConformance` **with** `shellOutProbe` and `readOnlyIntrospections`; `tools/list` deep-equals the eight names; packaging gate; cold start | Built bundle, fake on `PATH` |

Strict TDD: every row lands RED first. Every fixture value is imported from
`synthetic-identifiers.ts`.

---

## Threat Matrix

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, `README.sh` | **Applicable** — this package ships a checked-in **executable** script (`test/fake-bin/magento-cloud`), the first in the repo | Test-only, never published: outside `files` in `package.json` and outside the bundle. Spawned only with an explicitly injected `pathEntries`, never from a caller-supplied path | Tarball contains no `test/` entry; `locateBinary` rejects a non-executable candidate; the mode-bit assertion |
| Git repository selection | `git -C`, relative/absolute paths | **N/A** — no VCS automation | — | — |
| Commit state | staged, `commit -a`, empty index | **N/A** — no VCS automation | — | — |
| Push state | tracking branch, first push, refspec | **N/A** — no VCS automation | — | — |
| PR commands | `--head`, env prefix, composed commands | **N/A** — no PR automation | — | — |
| **Subprocess argument injection** | `;`, backticks, `$(…)`, `--` in `query`/`projectId`/`environmentId` | **Applicable** — the first package that really spawns | `execFile` with `shell: false` — one argv element, no local shell. `validateArgv` rejects a `--` passthrough token before spawn. The SSH-hop boundary is escaped by the CLI itself | A `query` containing `;`, backticks and `$(…)` reaches `execFile` as **one** argv element; a builder emitting `--` is rejected |
| **Subprocess environment inheritance** | `env: process.env`, a spread, a laundered copy | **Applicable** — this change opens the field | Decision 1's four layers, including the positive control | Sentinel test + its positive control; type test; source scan |
| **Subprocess stdio inheritance** | `stdio: "inherit"`; in-process `console.log` | **Applicable** — stdio server **and** a real child | `runAllowlisted` pins `stdio: "pipe"`; repo-wide eslint ban covers `packages/magento-cloud/src/**` | Domain-independent fd-1 probe **plus** `shellOutProbe` over a real child (Decision 9) |
| **Credential in process arguments** | token as argv, token in an error message | **Applicable** | The token is passed **only** in the child env, never in argv; an argv-level source scan asserts no spec builder emits it; `mcp-core` redaction over surfaced stderr | A captured argv for every spec contains no token-shaped value; a stderr fixture containing a token-shaped string is redacted |
| **Untrusted upstream text reaching the agent** | CLI stderr containing ANSI escapes, shell metacharacters, a token-shaped string | **Applicable** — CLI stderr is surfaced by design | Carried as a JSON string field, never interpolated into a command, path or URL; CLI path renders through `redact()` | Stderr with `;`, backticks, an ANSI escape and a token-shaped value round-trips as inert text and is redacted on the CLI path |

---

## Migration / Rollout

No data migration. `packages/magento-cloud` is new and nothing depends on it.

The one shared touchpoint is `mcp-core`. `env` is optional and additive, so no
existing caller changes behaviour and reverting the single commit restores
`env: {}` exactly. **Revert order matters**: `packages/magento-cloud` first, then
`mcp-core` — reverting `mcp-core` alone breaks the domain package's typecheck
loudly rather than silently spawning children with no environment.

Work unit 1 is the `mcp-core` field and its tests, before any tool work: the env
gap is load-bearing, and a package built on an unfixed executor would fail only at
the very end, against a real binary.

`servers.json` starts `status: "planned"` and flips to `"alpha"` in the final
commit. A bad published version is handled by `npm deprecate` plus a patch, never
unpublish-and-republish.

---

## Open Questions

- [ ] **`MINIMUM_SUPPORTED_CLI_VERSION` is PROVISIONAL.** Exploration found
      `VERSION = '5.3.1'` in the binary but could not confirm it is the CLI's own
      version rather than a bundled dependency's (`--version` was never executed).
      The check ships **warn-only** until confirmed by running `--version` once
      during apply. Does not block apply.
- [ ] **Rule 2 over-rejects arithmetic `SELECT a * b`.** Deliberate fail-closed
      choice (Decision 5). Confirm no intended diagnostic query needs it; the
      trigger to re-weigh a parser dependency against `dependencies: {}` is
      operators routing around the guard.
- [ ] **`ROW_CAP` and `maxOutputBytes` values are not yet chosen.** Both are
      required-no-default in `CommandSpec`. Pick during apply and record them as
      chosen-not-documented, with the same honesty as `aco`'s pace constants.
- [ ] **PATH mutation in the conformance test file.** Verified as the only
      channel `sanitizedEnv()` forwards, restored in a file-level `afterAll`.
      Confirm no cross-file leakage under the repo's vitest pool configuration
      during apply.
- [ ] **The proposal's last risk row is stale, and is corrected here rather than
      inherited.** It states the checked-in `exploration.md` is the superseded
      REST-only first pass. It is not: the file read for this design opens
      "SECOND PASS (change 4 of 5), supersedes the REST-only pass" and carries the
      CLI-wrapping evidence this design is built on. No refresh is needed;
      the risk row should be dropped at apply instead of acted on.
