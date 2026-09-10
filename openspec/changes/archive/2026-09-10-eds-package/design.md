# Design: eds-package — `hiberus-eds` CLI and `hiberus-eds-mcp` server

> Size note: this design exceeds the usual 800-word budget because the orchestrator
> brief required five separately-decided areas (conformance probe, client
> architecture, auth, nine tools, testing/cold-start) with rejected alternatives
> recorded for each. Tables carry the density.

## Technical Approach

`packages/eds` is scaffolded by `pnpm new-server eds`, then stripped of both template
tools (`noop`, `read-echo`) and filled with a pure-HTTPS domain client. The domain lives
entirely under `src/client/`, whose only public surface is `client/index.ts`; `cli.ts` and
`mcp.ts` are adapters that inject dependencies in and format results out. `mcp-core` is
consumed unmodified. `mcp-testing` gains a domain-independent fd-1 probe and a cold-start
budget; both are additive, and the existing `shellOutProbe` assertion is preserved verbatim.

Everything the client cannot know at compile time (JSON arriving from an MCP client) is
gated by zod at the wire; everything it can know (our own adapters calling the client) is
gated by TypeScript. That split is the organising principle for the two hazard gates.

---

## Architecture Decisions

### Decision 1: The domain-independent fd-1 purity probe

**Finding that reshapes this decision.** `mcp-core` exports `createStdioServer()`
(`packages/mcp-core/src/bootstrap/stdout-guard.ts`), which captures the real
`process.stdout.write`, hands it to a private `Writable` for the transport only, and
replaces `process.stdout.write` with a stderr forwarder prefixed `[stdout-diverted] `.
**Neither `templates/server/src/server.ts` nor `packages/fixture-server/src/server.ts`
calls it.** Both do `new StdioServerTransport()` with no arguments. So today's
stdout-purity assertion passes because nothing happens to write to stdout — not because
any mechanism prevents it. The suite has never proven M1 is installed, only that it was
not needed.

There are two independent mechanisms, and the current probe conflates them:

| Mechanism | Closes | Where it lives | Domain-independent? |
|---|---|---|---|
| M1 — stdout guard | in-process writes (`console.log`, a bundled dependency's raw `process.stdout.write`) | `createStdioServer()`, per server | yes — every server can install it |
| M4 — `stdio: "pipe"` | a child process inheriting fd 1 | `runAllowlisted`, per spawn site | no — only exists where a package spawns |

M4 cannot be closed in-process: fd inheritance is decided at each `spawn`. A
domain-independent probe therefore proves **M1**, and M4 stays proven by the existing
exec-based assertion plus a permanent negative control.

**Choice — three layers, all additive:**

1. **Extract `checkStdoutPurity(lines: readonly RawStdoutLine[]): readonly StdoutPurityViolation[]`**
   out of the `it()` block, mirroring the existing `checkToolMetadataComplete` /
   `checkReadOnlyIsolation` export pattern in `conformance.ts`. This makes the failure path
   directly drivable, which is exactly the gap `conformance-checks.test.ts` was written to
   close for the other two checks.

2. **`fd1-probe-harness.mjs`** (new, in `packages/mcp-testing/src/conformance/`). The suite
   spawns `node fd1-probe-harness.mjs <serverPath> <mode>` *instead of* the bundle
   directly, for one extra session. The harness `await import(serverPath)` — after which
   the bundle's top-level `await server.connect(transport)` has run and the guard, if
   installed, is active — then performs contamination attempts and stays alive so the
   normal `JsonRpcClient` can drive `initialize` + `tools/list` through it. The harness is
   the server; it adds no tool and knows nothing about the domain.

   | mode | contamination attempted | expected stdout |
   |---|---|---|
   | `divert` (run by `describeConformance`) | `console.log`, raw `process.stdout.write(string)`, `process.stdout.write(Buffer)` | pure JSON-RPC; the three payloads appear on **stderr** prefixed `[stdout-diverted] ` |
   | `inherit-child` (mcp-testing self-test only) | `spawn(node, ["-e","process.stdout.write('X\\n')"], { stdio: "inherit" })` | **contaminated** — asserts `checkStdoutPurity` fires |

   `inherit-child` is the positive control: it proves the probe has teeth and that fd
   inheritance is a genuinely detectable hazard, without ever running against a real
   server.

3. **Exec coverage is not weakened.** `shellOutProbe` becomes optional
   (`options.shellOutProbe !== undefined` guards the existing `it()`); when supplied, that
   `it()` runs byte-identically to today — same request, same `expectedResultText`, same
   assertion. On top of that, a new mcp-testing self-test builds a **contaminating exec
   subject**: a hand-rolled raw JSON-RPC subprocess (same technique as
   `conformance-checks.test.ts`'s `noncompliant-tool`) whose `tools/call` handler spawns a
   grandchild with `stdio: "inherit"` that writes to fd 1. Driven through `JsonRpcClient`
   and `checkStdoutPurity`, it MUST report a violation. That test is the standing proof
   that the exec-based path still fails on a contaminating child, and it will keep holding
   when `magento-cloud` arrives.

**Additive or replacement:** strictly additive. The new probe runs for every package. The
old probe runs for every package that supplies `shellOutProbe`. Nothing is deleted.
Reverting the single `mcp-testing` commit restores the previous suite exactly.

**Consequence that must be accepted:** the `divert` probe fails against any server that
does not install M1 — including `fixture-server` today. `packages/eds/src/mcp.ts` therefore
calls `createStdioServer()` and passes its `stdout` into
`new StdioServerTransport(process.stdin, bootstrap.stdout)`, and
`templates/server/src/server.ts` + `packages/fixture-server/src/server.ts` are corrected the
same way (they must move together —
`scripts/fixture-server-regeneration.test.mjs` asserts the fixture matches the template).
This is a two-file addition beyond the proposal's Affected Areas; it is recorded as an
Open Question below rather than smuggled in silently.

| Alternative | Why rejected |
|---|---|
| Ship a decorative `read-echo` in `packages/eds` | Explicitly forbidden by the proposal; every future non-exec package would carry dead scaffolding and an unused `execFile` allowlist entry forever |
| Replace the exec probe with the generic one | Silently reduces coverage for `magento-cloud`; the two mechanisms are different and both need proving |
| Add an MCP method (`$/contaminate`) to every server | Puts a test-only affordance in the shipped protocol surface of every production server |
| `--import` preload to contaminate | Runs *before* the main module, so it writes before the guard is installed — proves nothing |
| Ban `stdio: "inherit"` as a forbidden string in `verify-bundle.mjs` | Too many false positives from bundled SDK code. Instead: an eslint `no-restricted-syntax` rule on `packages/**/src/**` for `Property[key.name='stdio'][value.value='inherit']` — structural, where the constraint is structural |

### Decision 2: Client module layout and injected dependencies

`client/` is a function of its inputs. No `process.env`, no `console.*`, no `process.exit`,
no prompts, no colour — asserted by a source-scanning test, not review (a success criterion).

```
packages/eds/src/
  client/
    index.ts        public surface: createEdsClient, all error classes, all result types
    types.ts        wire + domain types (tolerant shapes)
    errors.ts       the typed error hierarchy
    http.ts         request build, auth header, single send() boundary, status→error mapping
    rate-limiter.ts token bucket over an injected clock
    retry.ts        pure policy: (outcome, attempt) -> {retry, delayMs}
    paths.ts        URL construction: {org}/{site}/{ref} vs {owner}/{repo}; snapshots pinned to main
    jobs.ts         job envelope parsing + waitForJob
    cursor.ts       nextToken walker
    auth.ts         TokenProvider wiring, mintApiKey, authStatus probes
    operations/     status.ts live.ts index-ops.ts site-config.ts snapshots.ts audit-log.ts
  testing/
    fetch-double.ts route-table fetch double + call recorder  (outside client/, so the
                    purity scan and the eslint client boundary stay clean)
  cli.ts   mcp.ts
```

`createEdsClient(deps: EdsClientDeps)` where
`EdsClientDeps = { fetch: typeof globalThis.fetch; now: () => number; sleep: (ms:number)=>Promise<void>; tokenProvider: TokenProvider; baseUrl: string; org: string; maxConcurrency?: number }`.
`client/index.ts` exports exactly: `createEdsClient`, `EdsClient`, `EdsClientDeps`, every
error class, every `*Result` type. Nothing else. The existing
`no-restricted-imports` pattern `["**/client/**", "!**/client/index.ts"]` in
`eslint.config.js` already enforces this — this change is its first real consumer, and a
deliberately-violating file under `packages/eds/eslint-fixtures/` proves the rule fires.

**Progress without stdout:** `waitForJob` takes `onProgress?: (p: JobProgress) => void`.
The CLI adapter renders progress to **stderr**; the MCP adapter accumulates and returns
only the terminal envelope. The client itself never writes anywhere.

| Alternative | Why rejected |
|---|---|
| `client/` reads `EDS_TOKEN` itself | Breaks purity, makes the client untestable without env mutation, and duplicates `resolveCredentialValue` |
| Client logs progress via mcp-core's `logger` | `logger` writes to stderr and would be safe, but it makes the client's output non-deterministic and couples a pure module to a global sink; a callback is testable |
| One flat `client.ts` | The purity scan and the boundary rule both work at file granularity; a flat file makes review of the auth/HTTP seam impossible |

### Decision 3: Two throttle errors that cannot be confused

```ts
export abstract class EdsError extends Error {
  abstract readonly kind: EdsErrorKind;
  abstract readonly remedy: string;
  readonly status?: number;
}

export class AdminRateLimitError extends EdsError {
  readonly kind = "admin-rate-limited" as const;
  readonly throttledBy = "admin-api" as const;
  readonly limit = "10 requests/second per project";
  readonly retryAfterMs?: number;
  readonly remedy = "This client exceeded the Admin API rate. The request pacer will back off and retry; if it persists, lower maxConcurrency or batch fewer paths per call.";
}

export class ContentSourceThrottledError extends EdsError {
  readonly kind = "content-source-throttled" as const;
  readonly throttledBy = "content-source" as const;
  readonly limit = "100 concurrent and 600 requests/minute per site to the content source";
  readonly xError: string;              // the raw x-error header text
  readonly remedy = "The CONTENT SOURCE behind this site is throttling, not the Admin API. Client-side pacing will not fix it: split the bulk operation into smaller batches and retry later.";
}
```

Three structural reasons they cannot be confused:

1. **One mapping site.** `mapThrottle(status, headers): AdminRateLimitError | ContentSourceThrottledError | undefined` in `http.ts` is the only constructor call for either class. Order is explicit: `status === 429` → admin; `status === 503 && (headers.get("x-error") ?? "").includes("(429)")` → content source; anything else → not a throttle.
2. **`throttledBy` is a literal discriminant.** Any consumer `switch`es on it under an `assertNever` default, so adding a third throttle source is a compile error at every consumer.
3. **The retry policy's input type is `AdminRateLimitError | TransientNetworkError | GatewayError`.** `ContentSourceThrottledError` is *not* in that union, so "retry the content-source one" is a type error, not a judgement call. Retrying it is the wrong remedy and the type system says so.

Tests: a raw `429` maps to admin and never to content-source; a `503` **with** `(429)` in
`x-error` maps to content-source; a `503` **without** it maps to `UpstreamUnavailableError`.
Three assertions, three distinct outcomes.

### Decision 4: `X-Auth-Token`, not `Authorization: token <key>`

Both are documented. The deciding evidence is in this repo, in
`packages/mcp-core/src/redact/redact.ts`: `KEY_VALUE_PATTERN` masks
`\b(token|…|authorization)\s*[:=]\s*([^\s,;]{1,256})`.

- `X-Auth-Token: <key>` — `\btoken` matches at the `-`/`T` boundary, `: ` is the separator, `<key>` is the value → redacts to `X-Auth-Token: ***`. **Key masked.**
- `Authorization: token <key>` — key group is `Authorization`, separator `: `, and the value group stops at the first whitespace, so it consumes the literal `token` and **leaves `<key>` in the clear**: `Authorization: *** <key>`.

Choosing `X-Auth-Token` makes the existing redaction correct by construction, with no
`mcp-core` change. Rejected: `Authorization: token <key>` (equally valid on the wire, but
defeats our own redaction, and invites intermediaries to treat it as a bearer token).
Rejected: extending `redact.ts` to handle the two-word form — that is an `mcp-core` change
the proposal excludes, to fix a problem a header choice removes.

### Decision 5: Pacing, retry, pagination, job polling

| Concern | Choice | Rationale / rejected |
|---|---|---|
| Pacing | One token bucket per client, `ratePerSecond: 10`, `burst: 10`, awaited before every send, over injected `now`/`sleep` | 600 requests/minute per site is exactly 10/s, so a single bucket satisfies both documented limits. Rejected: `MIN_GAP` sleep loop (untestable, drifts); rejected: two buckets (the tighter one always wins) |
| Concurrency | Semaphore, default 8, hard-capped at 100 | Documented ceiling is 100 concurrent; 8 keeps fan-out polite and is the number a test asserts. Rejected: unbounded `Promise.all` over `paths[]` |
| Retry | Max 3 attempts, full-jitter exponential backoff, base 250 ms, cap 4 s, honouring `retry-after`. Only on the retryable union above, and only when the request descriptor declares `idempotent: true` (a **required** field, so omitting it is a `tsc` error) | Rejected: retry-everything (replays writes); rejected: fixed delay (thundering herd across the 8-wide fan-out) |
| Pagination | Audit log only, opaque `nextToken` cursor. `cursor.ts` exposes `fetchPage` returning `{ entries, nextToken }`; the tool passes the cursor through and never auto-drains | mcp-core's `paginate()`/`paginationSchema` is page-number based; applying it to a cursor API would misrepresent the API's shape. `defineTool`'s 100 KB truncation backstop still applies |
| Job polling | Success is `response.ok` (2xx, so 202 passes). Poll the `links.self` URL from the envelope, never a reconstructed one. Terminal on `job.state ∈ {completed, stopped}`. Default `timeoutMs` 300 000, `pollIntervalMs` 1 000, both injected. On timeout throw `JobTimeoutError` carrying the last `progress` and the `self` link so the operator can resume via `eds_get_job_status` | The audited CLI records that the URL topic does not always match the response topic for bulk operations, so reconstructing the URL is a known bug source. Two tests: a 202 fixture resolves as success, and a source scan asserts no `=== 200` literal governs job success |
| Tolerant shapes | `parseSiteList()` accepts a bare array **or** `{ sites: [...] }` | Documented divergence; one parse point, two fixtures |
| Existence check | `getSiteConfig()` before any config `PUT` — a caught `409` is never the existence check | `409`-on-existing-PUT is inferred-only. A test asserts the recorded call order is GET-then-PUT |

### Decision 6: Auth — bootstrap, intake, minting, status

**`mcp-core` needs no changes. Verified by reading the source, not assumed:**

| Need | Existing primitive | Verdict |
|---|---|---|
| env over file over failure | `resolveCredentialValue({ domain:"eds", envVar:"EDS_TOKEN" })` (`credentials/resolve.ts:71`) | exact fit |
| `0600` atomic persist | `persistCredential("eds", token)` (`resolve.ts:86`) — `mkdir 0700`, tmp write at `0600`, `rename` | exact fit |
| static key provider | `StaticTokenProvider({ domain, resolve, remedy })` — **`remedy` is caller-supplied**, so EDS injects its own `Remedy` naming the out-of-band step without touching mcp-core | exact fit |
| remedy `cliCommand` | `buildRemedy` derives `hiberus-${domain} auth token set` → `hiberus-eds auth token set` | correct by construction |
| stdin-only intake | `readTokenFromStdin()` + `parseCredentialCliArgs()` (`credentials/cli.ts`) | exact fit |
| agent-facing failure | `defineTool.invoke` already catches `MissingCredentialError` and returns `{ isError: true }` with the formatted remedy | exact fit |

One honest wart, **not** a blocker and **not** a contradiction of the proposal:
`StaticTokenProvider.getToken()` catches any resolve failure and rethrows
`MissingCredentialError`, so a credential file at mode `0644` surfaces as "missing
credential" rather than `LooseCredentialFilePermissionsError`. Mitigation inside this
change: `auth status` and `auth token set` call `resolveCredentialValue` **directly**, so
the permission error surfaces verbatim on the CLI path where an operator can act on it.
Recorded as a follow-up for a later `mcp-core` change; no code here depends on fixing it.

**Day-one bootstrap sequence:**

```
  [1] Adobe admin / Sidekick UI          OUTSIDE this package
        operator creates the first admin-scoped key
                    │  (manual copy)
                    ▼
  [2] echo "$KEY" | hiberus-eds auth token set        stdin only
        readTokenFromStdin() ─→ persistCredential("eds", token)  0600
                    │
                    ▼
  [3] hiberus-eds auth status                          verify reachability
                    │
                    ▼
  [4] hiberus-eds auth mint --scope site --roles publish,author
        POST /config/{org}/sites/{site}/apiKeys.json   value shown ONCE
                    │
                    ▼
  [5] day-to-day: narrow key in EDS_TOKEN; bootstrap key stored away
```

Step [1] is never an opaque failure. EDS supplies its own `Remedy` whose `reason` field
reads: `not found — the first admin-scoped key can only be created in Adobe's admin/Sidekick
UI; see docs/eds-onboarding.md`. `formatRemedyMessage` then renders the full four-line
block through both the CLI and every MCP tool error.

**How a command-line token is made impossible, not merely discouraged** — four layers,
weakest to strongest:

1. `cli.ts`'s entry calls `parseCredentialCliArgs(argv)` **before dispatch**; any
   `--token`/`--token=` exits 1 with mcp-core's message.
2. The handler has no parameter to receive one: `setToken(deps: { readStdin: () => Promise<string>; persist: (t: string) => string }): Promise<CliRunResult>`. There is no token argument in the signature, so wiring one from argv would be a new function, not a new call.
3. The CLI's option table is a single exported `const CLI_OPTIONS: readonly OptionSpec[]`, and a test asserts no `name` matches `/token|key|secret|password/i`. Adding a `--token` option anywhere fails that test.
4. `scripts/scan-secrets.mjs` and the redaction above are the last line.

Tradeoff stated plainly: TypeScript cannot forbid a future contributor from writing a new
option; layer 3 is what converts "discouraged" into "structurally caught", and layer 2 is
what makes the accidental version impossible. Rejected: relying on documentation; rejected:
a runtime `assert` inside the handler (fires after the token is already in `argv`, and
therefore already in shell history).

**Minting, so losing the value is unmissable.** `mintApiKey()` returns
`{ id, value, roles, expiresAt }` and the client renders nothing. `cli.ts` is the only
renderer:

- **stdout** receives the key value **alone, on one line, undecorated**, so `| pbcopy` and `> key.txt` work.
- **stderr** receives everything else: a banner reading `This value is shown once and cannot be retrieved again. Store it now.`, the key id, roles, expiry, and the exact next command.
- `--persist` optionally pipes the minted value straight into `persistCredential`, closing the copy window entirely. It is explicit (never a default) because it overwrites the stored key, and it prints the path it wrote.
- A test asserts the unrecoverable-value warning is present on stderr and that the value appears exactly once across both streams.

**`auth status` without leaking the key.** Probes `GET /config/{org}.json`,
`GET /config/{org}/sites.json`, and — when a site is configured —
`GET /status/{org}/{site}/main/`. Reports per probe: the path (never the token), the HTTP
status, and a plain-English verdict (`reachable` / `key rejected (401)` /
`key lacks the required role (403)` / `org or site not found (404)`). Identity is reported
as an **8-hex-character fingerprint** of the key, labelled as such — enough to tell two
keys apart, useless as a credential. Every line passes through `redact()` before it is
written. Exit 0 if any probe returned 2xx, else 1.

### Decision 7: The nine tools, and the two hazard gates as types

**Blocking constraint found by reading `define-tool.ts`:**
`defineTool<TIn extends z.ZodObject, …>` requires a `ZodObject`. A
`z.discriminatedUnion(...)` is **not** a `ZodObject`, so the proposal's literal
`eds_reindex` schema will not type-check. Resolution without touching `mcp-core`: keep the
union in one nested field.

```ts
const reindexRequest = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("paths"),     paths: nonEmptyPaths }).strict(),
  z.object({ scope: z.literal("full-site"), confirmFullReindex: z.literal(true) }).strict(),
]);

export const edsReindexInput = z.object({
  site: z.string().min(1),
  ref:  z.string().min(1).optional(),
  request: reindexRequest,
}).strict();                       // ← a ZodObject, so defineTool accepts it
```

`z.infer` yields `request: { scope:"paths"; paths:string[] } | { scope:"full-site"; confirmFullReindex:true }`.
The full-site branch is unreachable without **both** the literal discriminant and the
literal `true`: `{ scope:"full-site" }` alone is not assignable, and
`{ scope:"full-site", confirmFullReindex:false }` is not assignable, because `z.literal(true)`
infers `true`, not `boolean`. Proven in `mcp.test-d.ts` under `vitest --typecheck`, the same
mechanism `define-tool.test-d.ts` already uses. `.strict()` means a stray
`confirmFullReindex` on the `paths` branch is a rejection, not silent extra data. A runtime
test asserts `edsReindexInput.safeParse` rejects both near-misses.

**Non-empty `paths` — where each mechanism actually earns its keep:**

| Boundary | Constraint knowable at compile time? | Mechanism |
|---|---|---|
| MCP wire (`tools/call` arguments arrive as `unknown` JSON) | **No** | `const nonEmptyPaths = z.array(z.string().min(1)).min(1)` — runtime rejection, and clean `minItems: 1` JSON Schema every MCP client understands |
| Client function boundary (our own adapters calling `client/`) | **Yes** | `paths: readonly [string, ...string[]]` — an empty literal is a `tsc` error at the call site |

This is the honest split. Claiming type-level enforcement at the wire would be false:
`z.array().min(1)` infers `string[]`, and a rest-tuple schema
(`z.tuple([z.string()], z.string())`) would buy an inferred `[string, ...string[]]` at the
cost of a `prefixItems` JSON Schema that is materially less portable across MCP clients.
Rejected for that reason. Inside the process, where the constraint *is* knowable, the
non-empty tuple type is used and costs nothing.

| Tool | Input schema (all `.strict()`) | Chains internally | Returns | Truncation / pagination |
|---|---|---|---|---|
| `eds_get_status` | `{ site, path, ref? }` | `GET /status/{org}/{site}/{ref}{path}` | per-partition object (`edit`/`preview`/`live`/`code`/`index`) | small; backstop only |
| `eds_get_status_bulk` | `{ site, ref?, paths: nonEmptyPaths, select?: ("edit"\|"preview"\|"live")[] }` | POST that queries; job envelope + `waitForJob` | `{ results[], ignoredPaths[] }` | backstop; `paths` capped at 100 in-schema |
| `eds_set_live_state` | `{ site, ref?, paths: nonEmptyPaths, state: "published"\|"unpublished", wait?: boolean }` | bulk POST → `waitForJob` when `wait` | `{ job, progress, ignoredPaths[] }` | `ignoredPaths` reports `/.helix/config` and `redirects.json`, which are always ignored |
| `eds_get_site_config` | `{ site }` | site doc + CDN + effective config, 3 GETs, concurrency-capped | one merged object | backstop |
| `eds_reindex` | as above | `paths` branch: explicit body; `full-site` branch: explicit full-site body — **never a bodyless POST** | `{ job, progress }` | backstop |
| `eds_get_audit_log` | `{ site, ref?, since?, nextToken?, limit? }` | one page | `{ entries[], nextToken }` | cursor passthrough; never auto-drains |
| `eds_get_snapshots` | `{ site, id? }` | list or show, pinned to `main` | array or one snapshot | backstop |
| `eds_manage_snapshot` | `{ site, id, verb: "add"\|"remove"\|"publish"\|"review"\|"delete", paths?: nonEmptyPaths, reviewAction?, message? }` | verb → endpoint; always an explicit JSON body + content type | `{ snapshot }` or `{ job }` | backstop |
| `eds_get_job_status` | `{ site, ref?, topic, name }` | one GET, success = any 2xx | `{ job, progress, links }` | backstop |

Annotations exactly as the proposal's table. Every `description` opens with **when to use
it**, which the metadata-completeness check already enforces as non-empty and a review item
enforces as useful.

### Decision 8: Cold-start budget — methodology only, no number

The number is an output of `sdd-apply`. This design fixes how it is produced.

1. `scripts/measure-cold-start.mjs`: build first, then `N = 20` iterations of
   `spawn(process.execPath, [dist/server.js])`, timing `performance.now()` at spawn until
   the `initialize` response, killing between iterations. No warm pool.
2. **Discard the first 3 samples** and record that they were discarded — they measure OS
   page-cache warm-up of a just-written bundle, not cold start.
3. **Statistic: p95** of the 17 retained samples. Not mean: cold start is a tail-latency
   property, and a shared CI runner's tail is what breaks builds.
4. **Threshold = ceil(p95_CI × 1.75) rounded up to the next 250 ms.** Measured on the CI
   runner via a `workflow_dispatch` job on `ubuntu-latest`, never on a dev machine. Local
   p50/p95 are recorded as a sanity check only and are explicitly labelled as such.
5. **Recorded in exactly one place**: `COLD_START_BUDGET_MS` in
   `packages/mcp-testing/src/conformance/cold-start.ts`, with a comment block holding N,
   discarded count, local p50/p95, CI p50/p95, runner label, date, and the multiplier. The
   new `mcp-conformance` requirement states the methodology and points at that constant, so
   the next person re-derives rather than inherits a magic number. Re-measure trigger:
   bundle byte size moves more than 20%.
6. **The assertion inside `describeConformance`** takes `M = 5` samples and compares the
   **median** to the budget. Tradeoff: median-of-5 trades sensitivity for stability — a
   single scheduler hiccup cannot fail CI, and a genuine regression moves the median. Using
   `max` was rejected as a guaranteed flake source on shared runners; using `mean` was
   rejected because one outlier drags it.

---

## Data Flow

```
  MCP client                                CLI operator
      │ tools/call                               │ argv (never a token)
      ▼                                          ▼
  mcp.ts  ── defineTool.invoke ──┐        cli.ts ── parseCredentialCliArgs
   (zod parse = the wire gate)   │          (stdin, env, formatting, exit codes)
                                 ▼                │
                        ┌────────────────────────┴──────────┐
                        │        client/index.ts             │   ← only public surface
                        ├────────────────────────────────────┤
                        │ operations/ ─→ jobs/cursor ─→ http │
                        │                       │            │
                        │            rate-limiter (10/s)     │
                        │            retry (idempotent only) │
                        └───────────────┬────────────────────┘
                                        │ injected fetch
                        ┌───────────────┴────────────────┐
                        │  real fetch  │  FetchDouble    │
                        └──────────────┴─────────────────┘

  token:  EDS_TOKEN ─→ $XDG_CONFIG_HOME/hiberus/eds.json (0600) ─→ MissingCredentialError
          resolved by mcp-core, attached once at http.ts's send() as X-Auth-Token
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/eds/**` | Create | Scaffolded by `pnpm new-server eds`; `private` removed for publish |
| `packages/eds/src/tools/read-echo.ts`, `.test.ts` | Delete | Template scaffolding; the package must ship no decorative tool. `noop` is removed from `server.ts` too |
| `packages/eds/src/client/{index,types,errors,http,rate-limiter,retry,paths,jobs,cursor,auth}.ts` | Create | The domain (Decisions 2–6) |
| `packages/eds/src/client/operations/{status,live,index-ops,site-config,snapshots,audit-log}.ts` | Create | One module per operation family |
| `packages/eds/src/cli.ts` | Create | `hiberus-eds`; `CLI_OPTIONS` table, stdin intake, `auth mint`, `auth status`, exit codes |
| `packages/eds/src/mcp.ts` | Create | `hiberus-eds-mcp`; nine `defineTool()` registrations; installs `createStdioServer()` |
| `packages/eds/src/testing/fetch-double.ts` | Create | Route table + call recorder; outside `client/` |
| `packages/eds/fixtures/*.json` | Create | Synthetic fixtures from `SYNTHETIC_ORG`/`SYNTHETIC_SITES`/`SYNTHETIC_DOMAIN` |
| `packages/eds/eslint-fixtures/deep-client-import.ts` | Create | Proves the client-boundary rule fires |
| `packages/eds/src/mcp.test-d.ts` | Create | Type-level proof of the reindex gate |
| `packages/mcp-testing/src/conformance/conformance.ts` | Modify | Export `checkStdoutPurity`; `shellOutProbe` optional; add the fd-1 probe and the cold-start assertion |
| `packages/mcp-testing/src/conformance/fd1-probe-harness.mjs` | Create | Domain-independent harness, two modes |
| `packages/mcp-testing/src/conformance/cold-start.ts` | Create | `COLD_START_BUDGET_MS` + the methodology comment block |
| `packages/mcp-testing/src/conformance/stdout-purity.test.ts` | Create | `inherit-child` control + the contaminating exec subject |
| `packages/mcp-testing/src/index.ts` | Modify | Export the new symbols |
| `templates/server/src/server.ts`, `packages/fixture-server/src/server.ts` | Modify | Install `createStdioServer()` (see Open Questions) |
| `eslint.config.js` | Modify | `no-restricted-syntax` banning `stdio: "inherit"` under `packages/**/src/**` |
| `scripts/measure-cold-start.mjs` | Create | The measurement harness |
| `openspec/specs/mcp-conformance/spec.md` | Modify | Delta owned by `sdd-spec` |
| `servers.json`, `README.md` | Modify | `eds` entry with the nine real tools; README regenerated, never hand-edited |
| `openspec/config.yaml` | Modify | `testing.projects` gains `eds` |
| `docs/eds-onboarding.md` | Create | The out-of-band first-key step, in full |

---

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit — errors | `429`→admin; `503`+`(429)`→content source; `503` without it→upstream | Three `mapThrottle` cases, three distinct classes asserted |
| Unit — pacing | 25 requests never exceed 10/s | `vi.useFakeTimers()` + injected `now`/`sleep`; assert recorded send timestamps |
| Unit — retry | Retries admin-throttle, never content-source, never a non-idempotent descriptor | Policy is pure; table-driven |
| Unit — jobs | 202 resolves as success; terminal-state detection; timeout carries `progress` + `self`; `self` link is used, never rebuilt | Fixtures `job.202.running.json`, `job.202.completed.json`; recorder asserts the polled URL |
| Unit — shapes | Bare-array and `{ sites: [...] }` both parse | Two fixtures, one parse point |
| Unit — cursor | Page 1 has `nextToken`, page 2 does not; the tool never auto-drains | Two fixtures + a call-count assertion |
| Unit — write safety | GET precedes every config PUT; no bodyless index or snapshot POST | Recorder asserts call order and that every POST body is non-empty with a content type |
| Unit — bulk ignores | `/.helix/config` and `redirects.json` are reported as ignored | Fixture with both submitted |
| Unit — purity | No `console.`, `process.exit`, `process.env`, prompt, ANSI escape, or `=== 200` under `client/` | Source scan over `client/**` |
| Type — gates | Reindex full-site branch unreachable without both literals; client `paths` rejects `[]` | `*.test-d.ts` under `vitest --typecheck` |
| Runtime — gates | `safeParse` rejects `{scope:"full-site"}`, `{confirmFullReindex:false}`, `paths: []`, unknown keys | Table-driven |
| CLI | No option matches `/token|key|secret|password/i`; `--token` exits 1; mint warning on stderr; value appears exactly once; `auth status` never contains the key | Option-table test + captured-stream assertions |
| Conformance | Nine tools' metadata; fd-1 `divert` probe with **no** `shellOutProbe`; packaging gate; cold-start median | `describeConformance` against the built bundle |
| Conformance — controls | `inherit-child` harness contaminates and `checkStdoutPurity` fires; contaminating exec subject still fails | mcp-testing self-tests; permanent regression guards |

All fixtures use `acme-demo-org`, `acme-demo-site-eu`, `acme-demo-site-us`, `example-domain`
and `example.test` — imported from `mcp-testing`'s `synthetic-identifiers.ts`, so there is
one source of truth and `scripts/audit-synthetic-identifiers.mjs` covers them. Strict TDD:
every row above lands RED first.

---

## Threat Matrix

The design touches a subprocess boundary (the conformance harness spawns processes; the
probe is about fd inheritance), so the matrix applies.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, `README.sh` | **N/A** — `packages/eds` classifies no file as executable and executes nothing from disk | — | — |
| Git repository selection | `git -C`, relative/absolute paths | **N/A** — no VCS automation in this change | — | — |
| Commit state | staged, `commit -a`, empty index | **N/A** — no VCS automation | — | — |
| Push state | tracking branch, first push, refspec | **N/A** — no VCS automation | — | — |
| PR commands | `--head`, env prefix, composed commands | **N/A** — no PR automation | — | — |
| **Subprocess stdio inheritance** (added) | child spawned with `stdio: "inherit"`; grandchild writing to fd 1; in-process `console.log`; raw `process.stdout.write(Buffer)` | **Applicable** | M1 via `createStdioServer()` in every server; M4 via `stdio: "pipe"` at every spawn site; eslint bans `stdio: "inherit"` under `packages/**/src/**` | `inherit-child` harness must contaminate; contaminating exec subject must fail `checkStdoutPurity`; `divert` harness must stay pure with the three payloads on stderr |
| **Credential in process arguments** (added) | `--token X`, `--token=X`, a positional token | **Applicable** | `parseCredentialCliArgs` before dispatch; handler has no token parameter; option-table test | `--token` and `--token=` both exit 1; option table contains no secret-shaped name |

---

## Migration / Rollout

No data migration. `packages/eds` is new. The `mcp-testing` amendment is additive and behind
an optional option, so reverting one commit restores the previous suite exactly. The
`servers.json` entry starts `status: "planned"` and flips to `"alpha"` in the final commit,
after the deliberate manual first publish. If a bad version reaches npm, the remedy is
`npm deprecate` plus a patch — never unpublish-and-republish.

---

## Open Questions

- [ ] **Scope amendment needed.** The domain-independent probe only means something if the
      subject installs M1, and neither `templates/server/src/server.ts` nor
      `packages/fixture-server/src/server.ts` calls `createStdioServer()` today. This design
      assumes both are corrected in this change (they must move together —
      `scripts/fixture-server-regeneration.test.mjs` couples them). That is two files beyond
      the proposal's Affected Areas. Confirm before `sdd-apply`, or the probe must be made
      opt-in and its value drops sharply.
- [ ] **`eds_reindex` JSON Schema shape.** Nesting the discriminated union under `request`
      is required by `defineTool`'s `ZodObject` constraint. Confirm during apply that the
      SDK renders the nested union as a usable `oneOf` for real MCP clients; if not, the
      fallback is a flat object plus `superRefine`, which loses the type-level guarantee and
      must be recorded as a downgrade rather than applied silently.
- [ ] **Extra API-key roles** (`basic_author`, `basic_publish`, `config`, `config_admin`)
      are CLI-observed, not doc-confirmed. `auth mint --roles` accepts the four confirmed
      roles as a closed enum and rejects the rest until corroborated. Confirm that is the
      wanted posture rather than an open string.
