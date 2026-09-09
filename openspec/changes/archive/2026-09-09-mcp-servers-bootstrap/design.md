# Design: mcp-servers-bootstrap — monorepo scaffolding and shared policy libraries

## Technical Approach

Build outside-in from constraints that cannot be retrofitted, in the proposal's order: **packaging gate → `mcp-core` primitives → `mcp-testing` → manifest/README**. Every safety property is placed at the strongest layer that can hold it:

| Enforcement layer | Used when | Applied to |
|---|---|---|
| **Type** (`tsc`) | Constraint is knowable at compile time from a literal | tool annotations, non-empty description, validated-argv brand, `TokenProvider` credential shapes |
| **Lint** (eslint flat config) | Constraint is structural in the source graph, not in values | client-boundary imports, SDK barrel ban, `exec`/`execSync` ban, `console` ban, license headers |
| **Runtime** (`mcp-core` bootstrap) | Constraint must hold for code we did not write | stdout diversion, output truncation, redaction, allowlist registration |
| **CI** (build + conformance) | Constraint is only observable in the built artifact | bundle shape, tarball `dependencies: {}`, stdout purity end-to-end, README staleness |

Each mechanism below states what it catches and what it misses. No single mechanism is claimed to be sufficient.

---

## Decision 1 — Packaging strategy (gates everything else)

### Evidence from the SDK (v1.30.0, read at `node_modules/@modelcontextprotocol/sdk/dist/esm/`)

`package.json` exposes a `"./*"` export wildcard → `dist/esm/*`, so deep-path imports are supported and stable. Static import closure of the stdio path:

```
server/mcp.js → server/index.js → shared/protocol.js → types.js            (zod)
              → server/zod-json-schema-compat.js                           (zod, zod-to-json-schema)
              → server/index.js:3  ../validation/ajv-provider.js           (ajv, ajv-formats)  ← PROBLEM
server/stdio.js → shared/stdio.js                                          (no deps)
```

`express`, `hono`, `@hono/node-server`, `cors`, `express-rate-limit`, `jose` appear **only** in `server/express.js`, `server/sse.js`, `server/streamableHttp.js`, `server/webStandardStreamableHttp.js`, `server/auth/**`, `client/sse.js`, `client/streamableHttp.js` and `examples/**` — **none reachable from `server/mcp.js`**. Tree-shaking is not even required for them; not importing the barrel is enough.

`ajv` is different and is the whole risk: `server/index.js:3` is a **static** ESM import, and line 51 reads `this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator()`. esbuild cannot drop a statically imported module whose class is instantiated on a live path.

### Predicted landing rung: **(b)**, deep-path import *plus* a narrow `ajv`/`ajv-formats` alias-stub

Not (a) alone, because of `server/index.js:3`. Not (c), because the stdio path is otherwise clean.

| Rung | Action | Move down when |
|---|---|---|
| (a) | Import only `@modelcontextprotocol/sdk/server/mcp.js` and `/server/stdio.js`; barrel and `/server/index.js` banned outside `mcp-core` by `no-restricted-imports` | Metafile still lists a forbidden input — **expected, for `ajv` only** |
| (b) | esbuild `alias: { ajv: 'stubs/ajv.js', 'ajv-formats': 'stubs/ajv-formats.js' }`. Safe **only** because `mcp-core.createServer()` always passes an explicit `jsonSchemaValidator`, so `AjvJsonSchemaValidator`'s constructor never runs. Stubs throw a named error on construction, so a regression fails loudly at startup rather than silently | Gate G2/G3/G7 still fails, e.g. a future SDK moves an HTTP transport onto the stdio path or drops granular exports |
| (c) | Vendor a minimal JSON-RPC-over-stdio server into `mcp-core` (framing + dispatch, ~300 LOC); SDK becomes types-only | — terminal; if reached, **stop before `eds-package`** and reopen packaging as its own change |

`mcp-core` supplies `noElicitationValidator` (`getValidator()` throws `McpError(InvalidRequest, 'elicitation is not supported by stdio servers')`). It is unreachable: the validator is used only at `server/index.js:358` on the `elicitInput` result path, and these servers declare no `elicitation` capability. `@modelcontextprotocol/sdk` is pinned to an **exact** version; the gate is what authorises an upgrade.

### The harness — `packages/fixture-server` (private, never published)

Not a throwaway. It is generated from `templates/server/`, committed, and is the permanent subject of both the packaging gate and the conformance suite. That is how the gate runs on **every build** rather than once.

`scripts/verify-bundle.mjs`, wired as turbo task `verify:package` (`dependsOn: ["build"]`), run by `pnpm verify:package` locally and in `ci.yml`:

| # | Gate | Method |
|---|---|---|
| G1 | Exactly one `.js` emitted in `dist/` | `readdir` |
| G2 | Bundle ≤ 2 MB | `statSync` |
| G3 | Zero forbidden modules | **Primary**: parse `tsup --metafile` output; assert no key of `metafile.inputs` matches `node_modules/(express\|hono\|@hono/…\|cors\|express-rate-limit\|jose\|ajv\|ajv-formats)/`. **Backstop**: grep the bundle text for the literal `node_modules/<pkg>/` provenance comments esbuild emits |
| G4 | Tarball `package.json` has no `dependencies` or `{}` | `npm pack` into a temp dir, extract, parse |
| G5 | First bytes are `#!/usr/bin/env node` | `read(0, 19)` on the bundle **and** on the tarball entry |
| G6 | `LICENSE` present in the tarball | `tar -tf` listing |
| G7 | `node dist/server.js` completes `initialize` + `tools/list` over stdio | conformance suite (below) |

The **metafile is authoritative**; the text grep exists only to catch a bundler that stops reporting truthfully. This is why `minify: false` — deterministic, greppable, readable stack traces; G2's budget is generous enough that minification buys nothing.

**Rejected**: `dependencies` allowlisting instead of `{}` (breaks `npx` cold start and the whole distribution model); `--packages=external` (defeats single-file); asserting on `pnpm why` (reports the dependency graph, not what actually landed in the artifact — the graph has always contained express).

---

## Decision 2 — Structural stdout safety

stdout is the JSON-RPC channel. Four layered mechanisms; **M1 is the guarantee, M3 is the proof**.

| # | Mechanism | Catches | Misses |
|---|---|---|---|
| **M1** | `createStdioServer()` captures `process.stdout.write` bound to `process.stdout`, wraps it in a private `Writable` given **only** to `StdioServerTransport`, then replaces `process.stdout.write` with a forwarder to stderr prefixed `[stdout-diverted]` | Any in-process write at runtime, from our code **or a dependency**, including `console.log`, `process.stdout.write`, and a bundled library's debug output | Writes from a **child process** that inherits fd 1; code paths that never execute |
| **M2** | eslint `no-console` + `no-restricted-properties` on `process.stdout` under `packages/*/src/**` | Authored code, at commit time, zero runtime cost, best error message | A dependency's writes; `globalThis['con'+'sole']` |
| **M3** | Conformance test spawns the **built** server as a subprocess and asserts every stdout chunk is a JSON-RPC frame and nothing else | Proves M1 actually holds end-to-end, including fd inheritance | Only the paths the session exercises |
| **M4** | Command executor always uses `stdio: 'pipe'`, never `'inherit'` | Child processes writing to our fd 1 | — closes M1's only real hole |

Feasibility is verified, not assumed: `server/stdio.js:9` is `constructor(_stdin = process.stdin, _stdout = process.stdout, options)` and sends via `this._stdout.write(json)` with an `'once("drain")'` fallback — a `Writable` subclass whose `_write` calls the captured real write satisfies both, with correct backpressure. After bootstrap, the only reference to the real fd-1 write is a closure inside `mcp-core`.

**Rejected**: lint alone (cannot catch a dependency's stray write — the exact failure mode that makes this bug opaque); a conformance test alone (asserts about paths that ran, proves nothing about paths that did not); closing fd 1 and reopening it (breaks the transport); `console.log = noop` (leaves `process.stdout.write` open and silently discards operator-visible diagnostics instead of routing them to stderr).

---

## Decision 3 — `defineTool()` with compile-time annotations

```ts
type NonEmpty<S extends string> = S extends '' ? never : S;

// read-only implies non-destructive and idempotent — but all three are still written explicitly
export type ToolAnnotations =
  | { readonly readOnlyHint: true;  readonly destructiveHint: false;   readonly idempotentHint: true;
      readonly title?: string; readonly openWorldHint?: boolean }
  | { readonly readOnlyHint: false; readonly destructiveHint: boolean; readonly idempotentHint: boolean;
      readonly title?: string; readonly openWorldHint?: boolean };

export function defineTool<
  TIn extends z.ZodObject<z.ZodRawShape>, TOut, const D extends string
>(def: {
  readonly name: string;
  readonly description: NonEmpty<D>;      // required, and `""` is a type error
  readonly inputSchema: TIn;
  readonly annotations: ToolAnnotations;  // required; every hint required
  readonly handler: (args: z.infer<TIn>, ctx: ToolContext) => Promise<TOut>;
}): RegisteredTool<TIn, TOut>;
```

A tool literal missing `idempotentHint` fails with TS2741 (missing property) or TS2322 (no union member matches). `readOnlyHint: true, destructiveHint: true` matches no member and fails. `description: ""` resolves `NonEmpty<''>` to `never`.

**Proving the negative case.** A runtime test cannot assert "this does not compile". `packages/mcp-core/src/tools/define-tool.test-d.ts` puts `// @ts-expect-error` above each must-not-compile construct and runs under `vitest --typecheck` (`typecheck.include: ['**/*.test-d.ts']`), wired into `pnpm test`. The directive inverts the assertion: **if the line ever starts compiling, tsc fails with "Unused '@ts-expect-error' directive"**. `expectTypeOf` covers the positive cases.

**Rejected**: runtime `assert(annotations.idempotentHint !== undefined)` (fails on the machine of whoever runs the server, not the author's — and only for tools that get invoked); a builder with chained required setters (enforces order, not presence, and reads badly); `satisfies` at the call site (opt-in, so an author who forgets it also forgets the check).

---

## Decision 4 — Allowlisted command executor

```ts
declare const Validated: unique symbol;            // NOT exported
export type Argv = readonly string[] & { readonly [Validated]: true };

export interface CommandSpec<A extends z.ZodTypeAny> {
  readonly bin: string;                    // fixed binary, resolved absolute at registration
  readonly subcommand: readonly string[];  // FULL subcommand, exact token list
  readonly argsSchema: A;
  readonly buildArgv: (args: z.infer<A>) => readonly string[];
  readonly timeoutMs: number;              // required — no default
  readonly maxOutputBytes: number;         // required — no default
}

export function validateArgv<A extends z.ZodTypeAny>(
  spec: CommandSpec<A>, raw: unknown
): Result<Argv, CommandRejection>;

export function runAllowlisted(spec: CommandSpec<never>, argv: Argv): Promise<CommandResult>;
```

**Encoding the audited contract.** "A validator must never validate a normalized copy and execute the raw input" becomes a type law: `runAllowlisted` accepts only `Argv`, a brand carried by a `unique symbol` that is not exported. A plain `string[]` — the raw input — does not satisfy it. The only producer of `Argv` is `validateArgv`, and it returns **the same array it validated**, never a source it re-derives. Passing unvalidated input to the executor is a compile error, not a review finding.

| Requirement | Mechanism |
|---|---|
| `execFile`, never `exec` | eslint `no-restricted-imports` on `node:child_process` named `exec`/`execSync`/`spawnSync` repo-wide; `execFile` permitted only under `packages/mcp-core/src/exec/**`. Called with explicit `shell: false`, `stdio: 'pipe'`, allowlisted `env` (never `process.env` wholesale), `maxBuffer: maxOutputBytes`, `timeout: timeoutMs`, `killSignal: 'SIGKILL'` |
| Allowlist by FULL subcommand | `Map` keyed on `[bin, ...subcommand].join(' ')`, exact `.get()`. eslint `no-restricted-syntax` bans `RegExp`, `.startsWith(`, `.includes(` and `.test(` under `src/exec/**`, so prefix matching cannot be reintroduced |
| Forbidden outright | `ssh`, `tunnel`, `db:dump` rejected at **registration time** (module init throws), so a forbidden command cannot even be constructed — the process fails to boot rather than failing per call |
| No `--` passthrough | `validateArgv` rejects any token equal to `--`, and `buildArgv` output is compared token-wise against the schema-derived expectation |
| Every argument validated | `argsSchema.safeParse` before `buildArgv`; failure returns `CommandRejection`, never a partial argv |

**Rejected**: shell-quoting plus a string command (safe only while the quoter is; array argv removes the shell entirely); regex allowlists (the audited source's own lesson); a `dangerouslyRun` escape hatch (an escape hatch in a shared policy library is the policy).

---

## Decision 5 — `TokenProvider` and credential loading

```ts
export type Credential =
  | { readonly kind: 'static'; readonly value: string }                             // EDS API key; ACO restricted access key
  | { readonly kind: 'minted'; readonly value: string; readonly expiresAt: number }; // IMS client_credentials

export interface TokenProvider {
  readonly domain: string;                    // 'eds' | 'aco' | …
  getToken(): Promise<Credential>;            // never prompts, never reads stdin, never hangs
  invalidate(generation: number): void;       // after a 401, invalidate only that generation
  describeRemedy(): Remedy;                   // { cliCommand, envVar, configPath, reason }
}
```

Two implementations, both shapes the roadmap needs, neither domain designed here:

- `StaticTokenProvider` — resolves once; `invalidate` is a no-op.
- `MintedTokenProvider({ mint, mintTimeoutMs, skewMs })` — expiry-aware cache; **single-flight coalescing** (concurrent callers share one in-flight promise) and a **generation stamp** so a 401 invalidates only the generation that produced it. There is no refresh grant: expiry re-mints from client id + secret. `mintTimeoutMs` is required, so a hung IMS call fails fast instead of stalling a tool call.

**Resolution**: `env[ENV_VAR]` → `$XDG_CONFIG_HOME/hiberus/<domain>.json` (default `$HOME/.config`) → **fail**. There is no third branch; the server never prompts. Writes go through `writeFileSync(tmp, data, { mode: 0o600 })` + `rename` (atomic), directory created `0o700`, and a read whose `stat` shows group/world bits is **refused**, not warned about. No native keychain, ever — it would break single-file bundling.

**Never a CLI argument**: `mcp-core` exports `readTokenFromStdin()` and no function that takes a token from argv. The CLI arg parser has no `--token` option at all; a test asserts `--token …` exits non-zero pointing at stdin. Shell history therefore cannot contain a token even by accident.

**Failure surface from an MCP tool call** — immediate and actionable, never a hang. `defineTool`'s wrapper maps `MissingCredentialError`/`CredentialExpiredError` to `CallToolResult { isError: true }`:

```
Missing credential for domain "eds".
Run:      hiberus-eds auth token set     (reads the token from stdin)
Or set:   EDS_TOKEN=<value>
Checked:  $XDG_CONFIG_HOME/hiberus/eds.json   (not found)
```

**Rejected**: keytar/native keychain (breaks bundling; the audited Python CLI's macOS-only `security` shell-out is explicitly not ported); a prompting fallback (an MCP server has no TTY — it would hang the agent forever, the exact failure this design exists to prevent); one flat `Credential = string` (cannot express expiry, forcing every domain to reinvent it).

---

## Decision 6 — Remaining structure

| Concern | Design | Rejected |
|---|---|---|
| **Redaction** | One pre-compiled alternation, single `String.replace` pass. Every quantifier sits on a **disjoint character class with a bounded upper limit** and none is nested, so there is no backtracking path — linear by construction, not by luck. Covers `key=value`/`key: value` for a closed key set, and `scheme://user:pass@host` → `scheme://***:***@host`. Anti-ReDoS test: 1 MB adversarial inputs, asserting runtime scales **sub-quadratically vs. a 1/10-size input** rather than against a wall-clock constant, so it is not machine-dependent | An `MCP_NO_REDACT` escape hatch (present in the audited source): an env var that disables redaction is precisely what a compromised environment sets. Also: nested-quantifier "smarter" patterns |
| **Truncation / pagination** | Pagination is the **intended** interface: a reusable zod fragment `{ page?: int≥1, pageSize?: int 1..N }` spread into tool schemas, with `nextPage` in the result. Truncation is a **backstop applied by the `defineTool` wrapper**, so no tool can return unbounded output even if its author forgot: cut at a UTF-8 boundary, append `[truncated: N of M bytes — request page 2]` | Truncation only (loses data with no way to retrieve it); pagination only (one careless tool still floods the context window) |
| **Conformance suite** | `packages/mcp-testing` exports `describeConformance({ serverPath })`, a vitest suite factory. Spawns the **built bundle** (`node dist/server.js`) with `stdio: ['pipe','pipe','pipe']` and a sanitized env, driving it with a ~120-line newline-framed JSON-RPC client. Asserts: `tools/list` answers; every stdout chunk is a JSON-RPC frame **and nothing else**; every tool has a non-empty description, a valid schema, and all three annotations; `readOnlyHint` tools invoke nothing outside the read allowlist (executor registry introspection); plus packaging gates G4–G6. Owns `catalog-views.csv` as a shared **synthetic** fixture | Using the SDK's own `Client` (parses frames away — inspecting the raw stream *is* the test); testing `src/` (would pass while the shipped artifact fails) |
| **`servers.json` + README** | `servers.json` (`{ servers: [{ name, bin, domain, description, status, envVars[], tools[{name, readOnly, description}], docs }] }`) validated by `schema/servers.schema.json` in CI. `scripts/gen-readme.mjs` renders between `<!-- servers:start -->`/`<!-- servers:end -->` markers. `--check` re-runs **the same code path** in memory and diffs against the committed file, exiting 1 with the diff, so the staleness check cannot drift from the generator | A separate checker (two implementations that disagree); a hand-written README |
| **`templates/server/` + `pnpm new-server`** | `scripts/new-server.mjs` copies the template, substitutes `__NAME__`/`__DOMAIN__`/`__BIN__`, appends to `servers.json`, regenerates the README. `packages/fixture-server` is itself generated from the template and committed; **CI regenerates it and asserts byte-equality**, so "a scaffolded package passes conformance unmodified" stays continuously true instead of true once | Documenting the scaffold steps; a template validated only at authoring time |
| **turbo graph** | `build: {dependsOn: ["^build"], outputs: ["dist/**"]}`, `typecheck: {dependsOn: ["^build"]}`, `lint: {}`, `test: {dependsOn: ["^build"]}` (conformance needs the bundle), `verify:package: {dependsOn: ["build"], inputs: ["dist/**"]}` | Running conformance from source (see above) |
| **Client boundary lint, for packages that do not exist yet** | Flat-config block scoped to `packages/*/src/{adapters,tools}/**` with `no-restricted-imports` patterns rejecting `**/client/**` except `client/index.js`. Validated **today** by `packages/mcp-core/eslint-fixtures/` — deliberately violating files plus a test that runs eslint programmatically and asserts the exact rule IDs fire. That is how a rule guarding future code is proven to work now | Writing the rule and trusting it until `eds-package` exercises it |

---

## Data Flow

```
   agent (MCP client)
        │ JSON-RPC over stdin
        ▼
  ┌─────────────────────────── mcp-core bootstrap ───────────────────────────┐
  │  captures real stdout.write ──► private Writable ──► StdioServerTransport│
  │  process.stdout.write := forward-to-stderr        (sole fd-1 holder)     │
  │                                                                          │
  │  defineTool registry ──► zod parse ──► handler ──► truncate ──► redact ──┼──► JSON-RPC out
  │        │                                   │                             │
  │        │                    TokenProvider ─┘   env > XDG config > FAIL   │
  │        │                                   └── validateArgv ─► Argv ─────┼──► execFile (pipe)
  │        └── missing/expired credential ──► isError CallToolResult          │
  └──────────────────────────────────────────────────────────────────────────┘
        │ everything else                                          stderr ◄──┘
```

Packaging gate:

```
templates/server ──generate──► packages/fixture-server ──tsup──► dist/server.js + metafile
                                        │                              │
                    byte-equality check ┘        verify-bundle.mjs ─► G1..G6
                                                 conformance suite ─► G7 + stdout purity
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `pnpm-workspace.yaml`, `package.json`, `.nvmrc`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig` | Create | Workspace, Node 22 engines pin, corepack `packageManager`, task graph |
| `eslint.config.js` | Create | Client boundary, SDK barrel ban, `exec` ban, `no-console`, license header, `no-restricted-syntax` for `src/exec/**` |
| `.changeset/config.json` | Create | Independent versioning, `access: public`, `provenance: true` |
| `.github/workflows/ci.yml`, `release.yml` | Create | install/lint/typecheck/test/build/`verify:package`/conformance/license allowlist/secret scan; OIDC trusted publishing |
| `LICENSE`, `CONTRIBUTING.md`, `CODEOWNERS`, `AGENTS.md`, `README.md` | Create | Apache-2.0 governance; README generated |
| `servers.json`, `schema/servers.schema.json` | Create | Single source of truth for the manifest |
| `scripts/verify-bundle.mjs`, `scripts/gen-readme.mjs`, `scripts/new-server.mjs` | Create | Packaging gate, README generator + `--check`, scaffold generator |
| `templates/server/**` | Create | Scaffold; substitution tokens `__NAME__`/`__DOMAIN__`/`__BIN__` |
| `packages/fixture-server/**` | Create | Private, unpublished; generated from the template; gate + conformance subject |
| `packages/mcp-core/src/{bootstrap,tools,exec,credentials,redact,truncate}/**`, `stubs/{ajv,ajv-formats}.js`, `eslint-fixtures/**` | Create | The six primitives, the alias stubs, the lint-rule fixtures |
| `packages/mcp-testing/src/{conformance,jsonrpc-client,fixtures/catalog-views.csv}/**` | Create | Suite factory, raw-stream client, shared synthetic fixture |
| `openspec/config.yaml` | Modify | `testing.status` → `implemented`; `projects` populated |

---

## Testing Strategy (Strict TDD — RED first for every row)

| Layer | What | Approach |
|---|---|---|
| Type | Missing/contradictory annotation, empty description, raw `string[]` passed to `runAllowlisted` | `*.test-d.ts` + `@ts-expect-error` under `vitest --typecheck` |
| Unit | Allowlist exact-match (prefix rejected), `--` rejected, `db:dump`/`ssh`/`tunnel` rejected at registration, timeout/maxOutputBytes enforced, redaction correctness + sub-quadratic scaling, credential precedence, `0600` mode + refusal on loose modes, truncation UTF-8 boundary | vitest, no network, no `$HOME` access (temp `XDG_CONFIG_HOME`) |
| Lint | Boundary/`exec`/`console` rules actually fire | eslint run programmatically over `eslint-fixtures/`, asserting rule IDs |
| Integration | Built bundle answers `initialize`/`tools/list`; **only** JSON-RPC on stdout; annotations present; scaffolded package passes unmodified | conformance suite against `dist/server.js` as a subprocess |
| CI/artifact | G1–G7, tarball `dependencies: {}`, shebang, `LICENSE`, README staleness, license allowlist, secret scan, `changeset status` + config/workflow validation (the real changesets CLI has no `--dry-run` flag for `publish`; see Migration/Rollout) | `verify:package` + workflow steps, every build |

---

## Threat Matrix

| Boundary | Adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, `README.sh` | **N/A** — this change classifies no file as executable; the only executables are declared `bin` entries in `package.json` | — | — |
| Git repository selection | `git -C`, relative/absolute paths | **N/A** — no VCS automation; `changesets`/`gh` run only in CI on the checked-out workspace, never on a caller-supplied path | — | — |
| Commit state | staged, `commit -a`, empty index | **N/A** — no commit automation in this change | — | — |
| Push state | tracking branch, first push, refspec | **N/A** — release publishing is npm via changesets; no git push is composed from input | — | — |
| PR commands | `--head`, env prefix, composed commands | **N/A** — `exception-ok` delivery; no PR automation | — | — |
| **Subprocess execution** (`mcp-core/src/exec`) | prefix-matched subcommand; `--` passthrough; `ssh`/`tunnel`/`db:dump`; argument-injected metacharacters; unbounded output; hung process; validate-copy-execute-raw | **Applicable** | Exact-match allowlist on full subcommand; `--` rejected; deny set enforced at registration; `execFile` with `shell:false` + array argv; required `maxOutputBytes`/`timeoutMs` + `SIGKILL`; branded `Argv` makes validate/execute divergence a type error | One RED test per case, all listed in the Unit and Type rows above |
| **Subprocess stream integrity** | child inherits fd 1 and writes to the protocol channel | **Applicable** | `stdio: 'pipe'` always, never `'inherit'`; M1 diversion covers the parent | Conformance test spawning a server whose tool shells out, asserting stdout stays pure JSON-RPC |

---

## Migration / Rollout

No migration — greenfield, zero commits, nothing published. **Correction (post-verify)**: this section originally asserted the release workflow would be verified by `changeset publish --dry-run`. That flag does not exist — the real changesets CLI's `publish --help` lists no `--dry-run` option for `publish`, confirmed directly against the installed CLI. No substitute dry-run was invented. What IS verifiable without a real publish, and what was actually run: `changeset status` (confirms the CLI resolves the workspace and reports changeset state correctly), `.changeset/config.json` schema/parse validity, and `ci.yml`/`release.yml` workflow syntax, alongside `npm pack` for packaging shape. The underlying safety property — that this change publishes no real versions — holds structurally today (every package `private: true`, every `version: "0.0.0"`, zero changeset files) but is not covered by an automated regression test; see the release-pipeline WARNING in `tasks.md` 12.9. If rung (c) is reached and still fails, stop before `eds-package` and reopen packaging as its own change rather than weakening `dependencies: {}` silently.

---

## Open Questions

- [ ] Does OIDC trusted publishing work for the `@hiberus-magento` scope? Falls back to a short-lived scoped `NPM_TOKEN` in the release job only, documented as a temporary deviation. Verifiable only against the real registry.
- [ ] Exact `maxOutputBytes` and `timeoutMs` defaults per tool are deliberately **not** set here — the type requires them per command, and real values arrive with real domains in `eds-package`.
- [ ] The synthetic `catalog-views.csv` column set is fixed here; whether the cross-domain EDS↔ACO scenario belongs to `eds-package`, `aco-package`, or a later integration change stays open (exploration risk 7).

*All examples, fixtures and sample values in this repository use synthetic organization, site and domain names.*
