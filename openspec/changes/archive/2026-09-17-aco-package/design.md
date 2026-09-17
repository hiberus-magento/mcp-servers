# Design: aco-package — `hiberus-aco` CLI and `hiberus-aco-mcp` server

> Size note: this design exceeds the usual 800-word budget for the same reason
> `eds-package`'s did — the brief required five separately-decided areas (error
> model, three credentials, six tools, pacing/pagination/admin surface,
> testing/fixture/cold-start) each with rejected alternatives recorded. Tables
> carry the density.

## Technical Approach

`packages/aco` is scaffolded by `pnpm new-server aco` and follows the architecture
`eds` established: the whole domain under `src/client/`, whose only public surface
is `client/index.ts`; `cli.ts` and `mcp.ts` are adapters that inject dependencies
in and format results out; `mcp-core` is consumed unmodified.

One structural difference reshapes everything below it. EDS's transport returns a
`Response` and maps failure from `response.status`. ACO returns **HTTP 200 with a
GraphQL `errors[]` array**, so a status-based transport is not a weaker design
here — it is a wrong one. The organising principle is therefore:

> **The status code and the GraphQL envelope are read by two different functions,
> and neither can see the other's input.** The function that classifies GraphQL
> failures has no `status` parameter. The function that reads `status` can only
> produce a transport error. There is no third path, and no function anywhere in
> `packages/aco` hands a caller an unclassified response body.

EDS's second organising principle carries over unchanged: what arrives as unknown
JSON from an MCP client is gated by zod at the wire; what our own adapters pass to
`client/` is gated by TypeScript. ACO adds a deliberate **inversion** of that rule
at the GraphQL wire — see Decision 5.

One scope correction precedes all of that. The proposal states the MCP server rides
the Merchandising track, but four of its six tools are backed by the admin surface.
Decision 0 states that contradiction, weighs the evidence for moving them, and
designs the two-tier surface that actually results.

---

## Architecture Decisions

### Decision 0: The proposal's Merchandising-track rationale does not cover four of the six tools

This is numbered 0 because it precedes the rest: it decides what the MCP surface
*is* before the others decide how it works.

**The contradiction, stated plainly.** `proposal.md` lines 63–65 commit the MCP
server to the Merchandising track and justify it: "the admin Bearer expires in
hours — an MCP server that dies mid-session waiting on a human to paste a token
from a browser devtools panel is not a server. The admin Bearer stays confined to
the CLI."

The same proposal's tool table (lines 112–117) chains four of the six tools to the
admin GraphQL surface:

| Tool | Actual backing surface |
|---|---|
| `aco_search_catalog` | Merchandising `productSearch` |
| `aco_get_facet_values` | Merchandising facet/bucket query |
| `aco_list_catalog_views` | **admin** `channels` |
| `aco_list_price_books` | **admin** `priceBooks` |
| `aco_list_policies` | **admin** `policies` |
| `aco_toggle_policy` | **admin** `updatePolicy` |

So two thirds of the surface needs exactly the credential the proposal says must
stay out of the server, and the stated rationale does not hold for those four. This
was not smoothed over in code: it is recorded here, and the design below is built
for the real shape rather than the stated one.

**Can `channels` / `priceBooks` / `policies` be read from Merchandising instead?**
That would be materially better — a read-only, credential-free surface for all six
tools — so it is worth answering with evidence rather than assumption.

Evidence available inside this repository (the orchestrator is checking Adobe's
documentation in parallel; this design does not block on it):

| Evidence | Source | Reading |
|---|---|---|
| `AC-View-ID` is a **required request header** on every Merchandising call | Adobe's Merchandising header docs, recorded in `exploration.md` | An API that requires the caller to name one view per request is not the API that enumerates views. The identifier is an input, not a result |
| `AC-Price-Book-ID` is an optional **request header** | same | Same shape: price-book identity is something the caller must already hold |
| `AC-Policy-{*}` are per-request **data-access filters** | same | Policies are applied as inputs, not listed as metadata |
| Merchandising is documented as read-only view-model catalog data | Adobe's Merchandising overview | `aco_toggle_policy` calls `updatePolicy`. A mutation is **definitively** not reachable on a read-only surface — this one needs no further research |
| The reverse-engineered CLI had access to both endpoints and queries `channels`, `policies`, `priceBooks` **only** via `admin/graphql` | `exploration.md`, operations list | The one implementation that has exercised a real tenant chose admin for all three |

**Verdict**: `aco_toggle_policy` is settled — admin, definitively. For the three
listing tools, no evidence of a Merchandising equivalent was found and the
structural counter-evidence above is strong, so this design proceeds on the admin
track for all four. This is stated as *no evidence found*, not as *proven absent* —
Adobe's documentation was not fetched in this phase.

**The seam, so a better answer stays cheap.** If Merchandising *does* expose any of
this metadata, migrating a tool across tracks is a one-field change plus a document
swap, because operations are phantom-typed by track (Decision 2) and the two
transports are already separate objects with separate deps:

```ts
// Moving a tool across tracks touches one literal and one document.
export const listPriceBooks: GraphQlOperation<"admin", ListPriceBooksResult> = { track: "admin", … };
//                                             └──► "merchandising"
```

Nothing in `tools/aco-tools.ts`, `errors.ts`, `graphql.ts` or the fixtures changes.
That is why this contradiction does not need to be resolved before apply begins.

**Designing for the honest reality: a two-tier surface.**

| Tier | Tools | Credential | Availability |
|---|---|---|---|
| **A — always available** | `aco_search_catalog`, `aco_get_facet_values` | none for unprotected views (Decision 2) | The life of the process. No credential can expire because none is sent |
| **B — credential-bound** | `aco_list_catalog_views`, `aco_list_price_books`, `aco_list_policies`, `aco_toggle_policy` | admin Bearer | Depends on which admin path the operator's org supports — see below |

Tier B has two genuinely different lifetimes, and conflating them is what produced
the contradiction in the first place:

- **Mint path available** (`ACO_CLIENT_ID`/`ACO_CLIENT_SECRET` work for
  `commerce.aco.admin` in this org): `MintedTokenProvider` re-mints on expiry with
  single-flight coalescing. Tier B is effectively permanent and the proposal's fear
  does not apply at all. This is a real case, just not a universal one.
- **Paste path only** (the case the Python CLI's field notes describe): Tier B has a
  hard horizon at the pasted Bearer's expiry.

**What the paste-only case actually means for a session — and why the server does
not die.** Three design properties, together:

1. **The credential is resolved per call, never cached at startup.**
   `PastedBearerProvider.getToken()` re-reads through `resolveCredentialValue` on
   every admin call. Cost: one small file read per admin tool call, negligible
   beside the network round-trip it precedes. Benefit: an operator who pastes a
   fresh Bearer with `hiberus-aco auth token set` while the server is running
   restores Tier B **without a restart**, on the very next tool call. The server
   degrades and self-heals; it does not die.
2. **Tier A is unaffected throughout.** Search and facets keep working while Tier B
   is expired, because the Merchandising transport has no `tokenProvider` field to
   read (Decision 2). This is enforced by types, not by care.
3. **Tier B fails in a way an agent can relay.** `defineTool.invoke` already catches
   `MissingCredentialError` and `CredentialExpiredError` and returns
   `{ isError: true }` with `formatRemedyMessage`'s four-line block — verified at
   `packages/mcp-core/src/tools/define-tool.ts:96–101`. That is exactly the
   "immediate actionable failure, never a hang" contract, and it needs no
   `mcp-core` change.

**The gap that needs closing, and how.** A pre-flight expiry throw is already a
`CredentialExpiredError`, so it is caught. But a *live* scope or 401 failure arrives
as `AdminScopeError`, which mcp-core does not know about and would therefore
propagate as a raw exception — an opaque failure, the exact thing the contract
forbids. So the four Tier-B handlers wrap their client call:

```ts
// tools/aco-tools.ts — the ONLY place an AcoError becomes an mcp-core credential error.
function relayCredentialFailure(error: unknown): never {
  if (error instanceof AdminScopeError) {
    // Re-thrown as the class defineTool already catches, carrying ACO's own
    // both-exits remedy in `Remedy.reason`, with Adobe's verbatim message appended
    // and the original error preserved as `cause` for the CLI path.
    throw new CredentialExpiredError(adminRemedyWith(error.message));
  }
  throw error;
}
```

Tradeoff, stated: `formatRemedyMessage` renders the reason on one line
(`Checked: <path>   (<reason>)`), so Adobe's message shares a line with the remedy
text. That is cramped. It is still strictly better than an uncaught exception, and
the alternative — teaching `mcp-core`'s `defineTool` to catch a domain error
interface — is an `mcp-core` change the proposal excludes for a problem one adapter
wrapper solves.

**The description is the only planning channel MCP gives an agent**, since
annotations are three fixed booleans. So every Tier-B tool's description ends with
one sentence naming the requirement and the recovery, e.g.: *"Requires an ACO admin
credential; if it has expired, run `hiberus-aco auth token set` and retry — the
server does not need restarting."* An agent that reads descriptions before planning
can then sequence Tier-A work first and treat Tier B as conditionally available,
instead of discovering it mid-plan.

| Alternative | Why rejected |
|---|---|
| Drop the four admin tools and ship a two-tool server | Honours the proposal's literal rationale and guts the surface. `aco_list_catalog_views` is how an agent discovers the `viewId` that Tier A *requires* as an argument — without it, Tier A is unusable except with a hand-supplied identifier |
| Ship all six but mark the four experimental | "Experimental" is not a machine-readable state in MCP and changes no behaviour. The tier is already legible through the description and through a typed, actionable error |
| Cache the resolved Bearer for the process lifetime | Makes the paste-only case genuinely fatal for the session, which is the failure the proposal was right to fear. Per-call resolution is what turns it into a recoverable one |
| Have the server prompt for a token | It has no TTY, and prompting is the hang the whole credential design exists to prevent |

### Decision 1: The error model — 200-with-`errors[]` cannot be mistaken for success

**The type.** `client/graphql.ts` brands a classified payload the way
`mcp-core/src/exec/command-spec.ts` brands `Argv`: the symbol is not exported, so
the brand is unforgeable outside the module that produces it.

```ts
// client/graphql.ts — `Classified` the symbol is NOT exported.
declare const Classified: unique symbol;

/** A GraphQL `data` payload that has been through `classify()`. Unforgeable elsewhere. */
export type ClassifiedData<T> = T & { readonly [Classified]: true };

interface GraphQlEnvelope {
  readonly data?: unknown;
  readonly errors?: readonly GraphQlErrorEntry[];
}

export interface GraphQlErrorEntry {
  readonly message?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * The ONLY producer of `ClassifiedData<T>` and the ONLY construction site for
 * every GraphQL-level `AcoError`. Reads `envelope.errors` BEFORE it reads
 * `envelope.data`, and — deliberately — takes NO `status` parameter. A status
 * code cannot influence GraphQL classification because it is not in scope here.
 */
export function classify<T>(envelope: GraphQlEnvelope, op: OperationRef): ClassifiedData<T>;

/** Operation parsers cannot be called on a raw body: the argument type is branded. */
export type OperationParser<T> = (data: ClassifiedData<unknown>) => T;
```

Three consequences that are `tsc` errors rather than review findings:

| Mistake | Why it cannot compile |
|---|---|
| "The status was 200, so use `body.data`" | `body.data` is `unknown`; every `parse` in `operations/` takes `ClassifiedData<unknown>`, which only `classify()` produces |
| "A 429 means throttled" | `classify()` has no `status` parameter, and `AcoThrottledError`'s constructor takes `{ extensions }` with no `status` field — a status-driven throttle is not expressible |
| "Return the raw response and let the caller decide" | `client/index.ts` exports no `Response`-returning function and no `GraphQlEnvelope` type; `http.ts`'s `send` is module-private |

**Where status is read.** Exactly one place, `readEnvelope()` in `http.ts`, and its
only possible failure output is `AcoTransportError`:

```
fetch rejects ─────────────────────────► AcoTransportError (cause)
body is not JSON ──────────────────────► AcoTransportError (unparseable)
JSON has neither `data` nor `errors` ──► AcoTransportError (no GraphQL envelope)
otherwise ─────────────────────────────► classify(envelope, op)   ← status discarded here
```

A 5xx that *does* carry a well-formed GraphQL envelope goes to `classify()` like
any other, because on this surface the envelope is the signal and the status is
noise. A 429 with no envelope is an `AcoTransportError`, never a throttle — which
is exactly the assertion the proposal's success criteria demand.

**The hierarchy, keyed off `extensions`.**

```ts
export type AcoErrorKind =
  | "catalog-view-access" | "admin-scope" | "throttled"
  | "operation" | "transport" | "schema-mismatch";

export abstract class AcoError extends Error {
  abstract readonly kind: AcoErrorKind;
  abstract readonly remedy: string;
  /** Literal discriminant. Every consumer switches on it under `assertNever`. */
  abstract readonly signalledBy: "graphql-errors" | "transport" | "client";
  /** How much to trust the classification. Surfaced to the agent, not just a comment. */
  abstract readonly confidence: "documented-extension" | "heuristic" | "certain";
}
```

| Class | Trigger in `errors[].extensions` | `confidence` | Remedy |
|---|---|---|---|
| `CatalogViewAccessError` | `x-commerce-exception === "access-key-invalid"` (exact value, not substring) | `documented-extension` | Register or rotate a restricted access key in Studio for this catalog view; carries the `AC-View-ID` that was sent |
| `AcoThrottledError` | `code`/`classification` matches `/throttl\|rate.?limit\|too.?many/i` | `heuristic` | Backoff and retry; the pacer will do it |
| `AdminScopeError` | `code`/`classification`/`message` matches `/permission\|scope\|unauthor\|forbidden/i` | `heuristic` | **Both exits**: re-attempt `hiberus-aco auth mint`, **or** paste a Studio session Bearer via `hiberus-aco auth token set` |
| `AcoOperationError` | anything else | `certain` (it is a failure; the *reason* is Adobe's, verbatim) | Surface `message` + `extensions` unchanged |

Classification order is fixed and tested: exact-value match first, then throttle,
then the scope substrings, then the fallthrough. Exact beats heuristic so a
throttle whose message happens to contain "forbidden" cannot be misrouted into a
credential remedy the operator would then act on pointlessly.

`confidence: "heuristic"` is a **runtime field, not a comment**. Adobe publishes no
structured code for either the scope or the throttle case, and an agent that reads
`"confidence":"heuristic"` in a tool error can weigh it. A comment next to the
regex is invisible three layers up.

**Partial success — `data` AND `errors` in one response.** Decided: **any non-empty
`errors[]` is a failure and `data` is discarded.** `classify()` throws before it
looks at `data`.

- *Why.* Every operation the six tools chain is a single root field. A partial
  response here is a failed operation with a nulled field, not a usefully degraded
  result. An agent handed `{ items: [...] }` silently missing half a tenant cannot
  tell, and has no way to ask.
- *What is not lost.* `AcoOperationError.hadPartialData: boolean` records that the
  server did return something, and the message says so, so a CLI operator debugging
  a genuine partial can reach for `hiberus-aco api query`. The payload itself is
  **not** attached — a large body in an error message ends up in logs.
- *Rejected:* returning `{ data, warnings }` — it forces a `warnings[]` an agent
  will ignore into all six return shapes, and makes "was this call successful" a
  judgement call at six call sites instead of one.
- *Rejected:* returning partial data only when `data` is non-null for the requested
  root field — that is a per-operation rule, i.e. six places to get it wrong, on a
  schema we cannot introspect.

**Retry safety, reused from EDS by type.** The retryable union excludes everything
that must not be replayed:

```ts
export type RetryableAcoError = AcoThrottledError | AcoTransportError;
// AdminScopeError | CatalogViewAccessError | AcoOperationError | AcoSchemaMismatchError
// are NOT members — retrying one is a tsc error, exactly as in eds/client/retry.ts.
```

| Alternative | Why rejected |
|---|---|
| `Result<T, AcoError>` return type instead of throwing | EDS's `http.ts` throws typed errors and `defineTool.invoke` already catches credential errors. Two error conventions in one repo is a worse cost than the ergonomic gain, and `Result` would still need the brand to stop callers reading `data` off the error branch |
| Classify on `errors[0]` only, like the Python CLI | The CLI's own convenience, not a contract. We scan every entry so an `access-key-invalid` behind a generic first entry is still found |
| Reuse `mapThrottle(status, headers)` from EDS | It is status-driven by construction. Porting it would import the exact bug this package exists to avoid |

### Decision 2: Three credentials, kept apart by types that cannot reach each other

**Track separation is structural, not conventional.** Operations are phantom-typed
by track, and the two transports have different dependency types:

```ts
export type Track = "admin" | "merchandising";

export interface GraphQlOperation<TTrack extends Track, TResult> {
  readonly track: TTrack;
  /** MUST be a named operation — see Decision 5 (the fixture double keys on the name). */
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly parse: OperationParser<TResult>;
}

export interface AdminTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly baseUrl: string;
  readonly tokenProvider: TokenProvider;          // ← admin only
  readonly apiKey?: string;                        // x-api-key
  readonly imsOrgId?: string;                      // x-gw-ims-org-id
}

export interface MerchandisingTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly baseUrl: string;
  /** Absent by default. Protected views only — see below. */
  readonly catalogViewAccessToken?: CatalogViewAccessTokenSupplier;
}
```

`MerchandisingTransportDeps` **has no `tokenProvider` field at all**, so an admin
Bearer cannot be sent to the Merchandising endpoint: there is nothing to read it
from. `AdminTransport.execute` accepts only `GraphQlOperation<"admin", T>`, so
routing an admin query over the merchandising URL is a `tsc` error.

**`X-Auth-Token` is unrepresentable.** Header assembly returns a
`Record<AcoHeaderName, string>`:

```ts
export type AcoHeaderName =
  | "Content-Type" | "Accept" | "User-Agent"
  | "Authorization" | "x-api-key" | "x-gw-ims-org-id"
  | "AC-View-ID" | "AC-Scope-Locale" | "AC-Price-Book-ID"
  | "AC-Catalog-View-Access-Token" | `AC-Policy-${string}`;
```

Tradeoff, stated: this holds at the assembly function's boundary only — `Headers`
accepts any string, so a determined caller could still `set()` one downstream. A
source-scan test over `packages/aco/src/**` for `/X-Auth-Token/i` covers the rest.
Type where knowable, scan where structural.

**Credential 1 — Admin IMS Bearer.**

`MintedTokenProvider` fits the *mint* path without modification. Verified by
reading `packages/mcp-core/src/credentials/token-provider.ts`, not assumed:
`mint()` is an async hook (line 102), `mintTimeoutMs` is required with no default
(line 104), `skewMs` gives early-refresh margin, `getToken()` coalesces concurrent
callers through `#inFlight` (lines 142–153) so two tool calls do not double-mint,
and `invalidate(generation)` clears only the generation that produced the 401
(lines 180–187). `CredentialExpiredError` is already exported and already generic.
Exact fit for `client_credentials` with no refresh grant.

**One verified wart to record now rather than discover during apply:**
`MintedTokenProvider.getToken()` calls `Date.now()` directly (line 138) rather than
an injected clock. Every module under `client/` takes `now` from its deps and is
deterministic; the admin provider is not. Consequence: expiry-boundary tests for
the minted path must use `vi.useFakeTimers()` or construct `expiresAt` relative to
real time. This is **not** a blocker and does **not** justify an `mcp-core` change;
it is a testing constraint that must land in `tasks.md`.

**LOUD, per the brief:** `mcp-core` has **no provider for the paste path**, and one
is not being added. `StaticTokenProvider` cannot express expiry; `MintedTokenProvider`
mints, and there is nothing to mint from a value a human pasted. The gap is filled
by a small domain class implementing mcp-core's **exported, unchanged**
`TokenProvider` interface:

```ts
// packages/aco/src/credential-provider.ts — adapter layer, never inside client/
export class PastedBearerProvider implements TokenProvider {
  // resolveCredentialValue({ domain: "aco", envVar: "ACO_TOKEN" })
  // → decodeClaimsUnverified(jwt)  (created_at/expires_in ONLY; no signature check)
  // → expired?  throw new CredentialExpiredError(remedy)   ← BEFORE any request
  // → { kind: "minted", value, expiresAt }
  constructor(options: { readonly now: () => number; readonly remedy: Remedy; /* … */ });
}
```

It takes an injected `now`, so the paste half stays deterministic even though the
mint half cannot. `git diff` under `packages/mcp-core/` stays empty.

**Composition — both paths primary, no auto-chaining.** Selection is a pure,
unit-testable function; the CLI's `auth status` prints its verdict and the reason:

```ts
export function selectAdminProvider(input: {
  readonly storedOrEnvBearer: boolean;
  readonly clientCredentials: boolean;
}): { readonly selection: "pasted-bearer" | "minted" | "none"; readonly reason: string };
```

> **Corrected 2026-09-17.** This section previously justified the precedence
> below by asserting that `client_credentials` does not work for
> `commerce.aco.admin`, citing the Python CLI's field notes and a direct test.
> That premise is FALSE. The test was sound but ran against a credential from a
> Developer Console project lacking the **Adobe Commerce Optimizer Admin** API,
> and a credential can only request scopes for APIs its project actually has.
> With that API added, the grant works: the minted token's decoded JWT carries
> `scope: "commerce.aco.admin,openid,AdobeID"`. **Minting is the primary path.**
>
> The precedence below is unchanged, because it never depended on that premise —
> only its stated rationale did. The real reason follows.

Precedence: **a stored/env Bearer wins over client credentials.** Pasting a Bearer
is a deliberate act: an operator does it to use that specific token, usually to
reproduce something or to work without console access. Letting a mint attempt
silently override it would send a different credential than the operator believes
is in use — surprising in the moment, and unanswerable afterwards from the error
alone. Presence is the signal; no extra configuration is needed to express it.
`hiberus-aco auth mint` stays an explicit command.

| Alternative | Why rejected |
|---|---|
| Try mint, fall back to paste on failure | Silently sends a different credential than the operator believes is in use, and makes "which one failed" unanswerable from the error |
| Mint wins over a stored Bearer | Discards an explicit operator choice in favour of an implicit one, which is the wrong default even now that minting works |
| An `ACO_AUTH_MODE` env var | A third configuration knob to explain, to make explicit a precedence that presence already determines unambiguously |

A scope failure at mint time surfaces as `MissingCredentialError` whose `Remedy.reason`
names **both** exits verbatim, so `formatRemedyMessage` renders them through the CLI
and through every MCP tool error unchanged.

**Credential 2 — Merchandising.** Adobe documents authentication as **not required
by default**; only a catalog view with Catalog Protection enabled needs one, and
that one is an RS256 JWT signed per request from a locally-held RSA private key,
sent as `AC-Catalog-View-Access-Token`. `AC-View-ID` is required routing (not a
credential); `AC-Price-Book-ID` and `AC-Policy-{*}` are optional routing.

**Decision: per-request RS256 signing is DEFERRED, and the seam ships now.**

- *The unprotected case costs nothing.* `catalogViewAccessToken` is `undefined`;
  no header is emitted, no key file is read, no provider is constructed, no crypto
  module is imported, and the bundle carries no signing code. The Merchandising
  transport's construction path touches no credential machinery whatsoever.
- *The protected case is an extension, not a rewrite.* Three things exist today:
  (1) `CatalogViewAccessTokenSupplier` is a field on `MerchandisingTransportDeps`
  and is exercised by a test that passes a stub supplier and asserts the header is
  attached exactly once per request with the supplier's value; (2)
  `CatalogViewAccessError` is classified from `x-commerce-exception` and carries an
  actionable remedy, even though nothing in this change can produce it; (3)
  `protectionEnabled` is parsed and returned by `aco_list_catalog_views`. Adding
  signing later is one new adapter-layer module plus one wiring line — zero changes
  under `client/`.
- *Evidence that fires the trigger*, stated so nobody has to guess: a
  `CatalogViewAccessError` observed against a configured view, **or**
  `protectionEnabled: true` on a view in `aco_list_catalog_views` output. Both are
  observable from the shipped surface without new instrumentation.

| Alternative | Why rejected |
|---|---|
| Build RS256 signing now | No target view is protected. Speculative crypto in a published bundle, with a key-loading path nothing exercises and a test suite that can only prove it against itself |
| Add an RSA-signing provider to `mcp-core` | An `mcp-core` change the proposal excludes, for one hypothetical consumer. Neither existing provider signs per request; that is a genuinely different primitive and deserves its own change when a second domain needs it |
| Treat `AC-View-ID` as a credential | It is routing. Modelling it as a secret would put a non-secret through the credential file, the redaction path, and the stdin-only intake gate, for nothing |

**Credential 3 — `X-Auth-Token`.** EDS's. Structurally absent, per the header union
plus the source scan above.

### Decision 3: The six tools, and the exclusions as types

`aco_*` tools live in `src/tools/aco-tools.ts`, separate from `mcp.ts`, for the same
reason `eds-tools.ts` is separate: `mcp.ts` must call `server.connect(transport)`
unconditionally at module top level for the shared fd-1 conformance probe, and a
module that connects on import cannot be imported by unit tests.

| Tool | Tier (Decision 0) | Input schema (all `.strict()`) | Chains | Returns | Annotations `RO/D/I` | Truncation / pagination |
|---|---|---|---|---|---|---|
| `aco_search_catalog` | **A** — merch, no credential | `{ viewId, locale, phrase, pageSize?: int 1–100, currentPage?: int ≥1, priceBookId? }` | merch `SearchCatalog` (`productSearch`) | `{ totalCount, items[], facets[] }` | `true/false/true` | Page-number paging is the API's own shape, so `mcp-core`'s `paginationSchema` semantics apply; `pageSize` capped at 100 in-schema; 100 KB `defineTool` backstop |
| `aco_get_facet_values` | **A** — merch, no credential | `{ viewId, locale, attribute, priceBookId? }` | merch `FacetValues`, **one query, always** | `{ facetable: true, values: [{ value, count }] }` \| `{ facetable: false, reason }` | `true/false/true` | Bounded by one facet response; backstop only |
| `aco_list_catalog_views` | **B** — admin Bearer | `{ includeDrafts?: boolean }` (default `false`) | admin `ListChannels` | `{ views: [{ channelId, name, locales[], defaultPriceBookId?, policyIds[], protectionEnabled? }] }` | `true/false/true` | Not paginated by the API; backstop only, and a truncation there is a real signal (a tenant with more views than fit) |
| `aco_list_price_books` | **B** — admin Bearer | `{ size?: int 1–200, searchTerm?, scrollId? }` | admin `ListPriceBooks` | `{ items: [{ id, name, currency, level, parentIds[] }], scrollId? }` | `true/false/true` | **The only cursor tool.** Passes `scrollId` through, never auto-drains |
| `aco_list_policies` | **B** — admin Bearer | `{}` | admin `ListPolicies` | `{ policies: [{ policyId, name, mandatory, actions[] }] }` | `true/false/true` | Backstop only |
| `aco_toggle_policy` | **B** — admin Bearer | `{ mode: z.literal("named"), names: nonEmptyPolicyNames, enabled: boolean }` | admin `ListPolicies` → `UpdatePolicy` per name, paced | `{ results: [{ name, previous, current, changed }] }` | `false/true/true` | `names` capped at 50 in-schema; one response row per name |

Every `description` opens with **when** to use the tool, which
`checkToolMetadataComplete` already enforces as non-empty. Every **Tier B**
description additionally closes with the credential requirement and the
no-restart-needed recovery, per Decision 0 — a test asserts that all four Tier-B
descriptions contain `hiberus-aco auth token set` and that neither Tier-A
description does.

**`aco_toggle_policy` has no `{ mode: "all" }` branch. The type:**

```ts
export const nonEmptyPolicyNames = z.array(z.string().min(1)).min(1).max(50);

export const acoTogglePolicyInput = z
  .object({
    mode: z.literal("named"),      // the ONLY literal. There is no second one.
    names: nonEmptyPolicyNames,
    enabled: z.boolean(),
  })
  .strict();

// z.infer<typeof acoTogglePolicyInput>["mode"] is exactly "named".
```

Why `mode` is kept at all rather than dropped: it renders as `"enum": ["named"]` in
the JSON Schema an agent reads, so the *absence* of an "all" branch is legible on
the wire instead of being invisible. Dropping `mode` would make the tool look like
it had never considered the question.

Rejected: EDS's nested `z.discriminatedUnion` under a `request` field. That shape
exists in `eds_reindex` because `defineTool` requires a top-level `ZodObject` and
the union has two genuine branches. Here there is one branch, so the union buys
nothing and costs a nesting level; a flat `z.literal("named")` gives the identical
inferred type and the identical rejection.

Three independent proofs, each at the layer where the constraint is actually
knowable — the tradeoff for each is stated, not implied:

| Layer | Mechanism | What it proves | What it cannot |
|---|---|---|---|
| Type | `mcp.test-d.ts` under `vitest --typecheck`: `expectTypeOf<Input["mode"]>().toEqualTypeOf<"named">()`, and `{ mode: "all", … }` is not assignable | Our own code cannot construct an "all" call | Nothing about JSON arriving from a client |
| Runtime | `safeParse` rejects `mode: "all"`, `names: []`, `names` omitted, and any unknown key (`.strict()`) | Untrusted wire input is rejected | Nothing about what the built server actually registered |
| CI (artifact) | Conformance: `tools/list` on the **built bundle** returns `properties.mode.enum` deep-equal to `["named"]` for `aco_toggle_policy` | What ships is what was designed | Slow; only runs after `pnpm build` |

**`aco_get_facet_values` cannot reach the brute-force loop.** The Python CLI, when
an attribute is not facetable, falls back to sampling up to *pages* full
product-list queries. Proving that is unreachable, in four layers, strongest last:

1. **The loop is not written.** No page-sampling function exists anywhere in
   `packages/aco`.
2. **The return type has nowhere to put sampled values.** `FacetValuesResult` is a
   closed union — `{ facetable: true; values } | { facetable: false; reason }` — so
   adding sampling means changing an exported type in `client/index.ts`, a visible
   named diff, not a quiet extra `await` inside a handler.
3. **The boundary rule.** Even if a sampling helper were added to a deep
   `client/` module, `no-restricted-imports` (`eslint.config.js`, the
   `["**/client/**", "!**/client/index.ts"]` pattern) stops `tools/aco-tools.ts`
   importing it, and `client/index.ts` would have to export it deliberately.
4. **A request-count assertion, which is the real proof.** With a fixture whose
   facet response contains no buckets for the requested attribute, the tool returns
   `{ facetable: false, reason }` and `fetchDouble.calls` has **length 1**. A
   fallback that fired would move that number, and the number is asserted.

**Exactly six tools, asserted three ways** (mirroring `packages/eds/src/mcp.test.ts:49`):

- Unit: `createAcoTools(...).map((t) => t.name).sort()` deep-equals the six names,
  and `toHaveLength(6)`. Fast, precise, tests the factory.
- Unit, negative: the `CLI_ONLY_OPERATIONS` list — `provision`, `view delete`,
  `view prune`, `policy delete`, `policy disable --all`, `policy init`, `api query`,
  and every `auth`/`profile` subcommand — is asserted to have no corresponding tool
  name, so adding one fails a test that names the operation.
- Conformance: `tools/list` against the built bundle returns exactly those six.
  Slow, but it is the only one that tests what ships.

### Decision 4: Pacing, pagination, the admin surface, and a schema we cannot introspect

**Pacing — reuse the pattern, copy the module, and say the numbers are chosen.**

`packages/eds/src/client/rate-limiter.ts` is a sliding-window limiter over an
injected clock. It is deliberately *not* exported from `eds`'s `client/index.ts`
(internal wiring), and the boundary rule forbids a deep import, so `aco` gets its
own copy at `packages/aco/src/client/rate-limiter.ts` — same algorithm, same
injected `now`/`sleep`, same tests.

| Alternative | Why rejected |
|---|---|
| Import it from `@hiberus-magento/eds` | Creates a domain→domain runtime dependency, drags `eds`'s bundle into `aco`'s, and violates the client boundary rule |
| Promote it to `mcp-core` | An `mcp-core` change the proposal excludes. With two consumers and no third, duplication is cheaper than the coupling. **Recorded follow-up: a third consumer is the trigger to promote it.** |
| Port the Python CLI's `sleep(0.3)`/`sleep(0.4)` | Fixed sleeps are untestable, drift under real timers, and were absent from read paths entirely |

The numbers, stated as what they are:

```ts
// CHOSEN, NOT DOCUMENTED. Adobe publishes no rate limit for either ACO surface.
// The only pacing ever observed to work against a real tenant is the Python CLI's
// 0.3–0.4 s courtesy delay between writes (~2.5–3.3 requests/second). 4/s is the
// honest upper bound of that evidence, not a limit anyone has published.
export const ADMIN_PACE = { ratePerSecond: 4, burst: 4 } as const;
// Merchandising is a read surface with no observed pacing at all; 10/s matches the
// EDS default so the two packages do not drift for no reason. Also undocumented.
export const MERCH_PACE = { ratePerSecond: 10, burst: 10 } as const;
```

**Throttle detection is heuristic and labelled at three levels**: a comment at the
regex, `confidence: "heuristic"` on the error instance, and the word "heuristic" in
the remedy text an agent reads. There is no `Retry-After` on this surface — there is
no HTTP-level throttle response to carry one — so `retryAfterMs` is always
`undefined` for ACO and backoff is always full-jitter exponential. The retry budget
is EDS's `MAX_RETRY_ATTEMPTS = 3` with the required `idempotent` field: the six
mutations declare `idempotent: false`, so a misclassified throttle on
`updatePolicy` cannot replay a write, and three attempts cannot become a storm.

**Pagination — `scrollId`, `priceBooks` only, enforced by shape.**

```ts
export interface ScrollPage<T> { readonly items: readonly T[]; readonly scrollId?: string; }
// Only ListPriceBooksResult is a ScrollPage. No other result type carries `scrollId`,
// and no other operation's variables type accepts one — so "paginate the policies
// query" is a tsc error, not a runtime surprise.
```

The tool passes the cursor through and never auto-drains, exactly as
`eds_get_audit_log` does. Test: page 1 carries a `scrollId`, page 2 does not, and a
call-count assertion proves no third request was issued.

**The six admin mutations, closed.**

```ts
export type AdminMutationName =
  | "createChannel" | "updateChannel" | "deleteChannel"
  | "createPolicy"  | "updatePolicy"  | "deletePolicy";
```

`client/operations/mutations.ts` is the only module that builds a mutation document,
and a source-scan test asserts the token `mutation ` appears in no other file under
`client/`. A seventh mutation is a named, reviewable diff in one file.

**Defensive parsing, because the schema is a reverse-engineered guess.**

There is no public documentation for `commerce.aco.admin` and no introspection was
available. Fidelity is bounded by the Python CLI's literal query strings. The rule,
and it is a deliberate **inversion** of the zod-at-the-wire principle:

| Wire | Gate | Why |
|---|---|---|
| MCP `tools/call` arguments | zod, `.strict()`, reject unknown keys | We own this contract. Extra keys mean the caller misunderstood it |
| GraphQL responses | hand-written tolerant narrowing, **no** `.strict()`, unknown fields pass through | We do **not** own this contract and cannot see it. Rejecting an unanticipated shape is precisely the crash we are avoiding |

Concretely: every wire type has all fields optional except the identity fields the
six tools key on (`channels[].channelId`/`name`, `priceBooks.items[].id`,
`policies[].policyId`/`name`). A missing optional field yields `undefined` in the
result and the tool call succeeds. A missing **keyed** field throws
`AcoSchemaMismatchError`, whose remedy names the operation, the field path, and the
recovery route:

> `ListChannels` expected `channels[].channelId` and it was absent. The ACO admin
> GraphQL surface is undocumented; this query was derived from a reverse-engineered
> client and may be stale. Compare against a live response with
> `hiberus-aco api query`, then correct the document in
> `client/operations/channels.ts`.

That is the honest failure mode: the client fails **loudly, named, and with the
file to edit**, rather than returning a silently half-empty object. Rejected:
validating GraphQL responses with zod (turns every unanticipated Adobe field into a
tool-call failure); rejected: `as` casts with no narrowing (turns a schema drift
into an undefined-property crash three frames later, with no operation name).

### Decision 5: Testing, the shared fixture, and the cold-start trigger

**The fetch double needs a third response shape, and a fourth key component.**

`packages/eds/src/testing/fetch-double.ts` keys routes on `"<METHOD> <pathname><search>"`.
Every ACO request is a `POST` to one of two paths, so that key does not
discriminate. `packages/aco/src/testing/fetch-double.ts` keys on
`"<METHOD> <pathname> <operationName>"`, extracting the name from the posted
document.

That has a real design consequence, which is why it is here and not in tasks:
**every document in `client/operations/` must be a named operation**
(`query ListPriceBooks(...)`, not `query { ... }`). A source-scan test enforces it.
The Python CLI's anonymous documents would not be keyable — and named operations
also make `AcoSchemaMismatchError` and every log line nameable, which is worth
having on its own.

Fixture helpers, with the trap made into a named constructor:

```ts
export const graphQlOk      = (data: unknown): RouteResponse => ({ status: 200, body: { data } });
/** HTTP 200. `response.ok` is true. AND IT IS A FAILURE. */
export const graphQlErrors  = (errors: readonly GraphQlErrorEntry[]): RouteResponse =>
  ({ status: 200, body: { data: null, errors } });
/** Both halves present — the partial-success case from Decision 1. */
export const graphQlPartial = (data: unknown, errors: readonly GraphQlErrorEntry[]): RouteResponse =>
  ({ status: 200, body: { data, errors } });
/** A status-only failure with NO GraphQL envelope. MUST NOT classify as a throttle. */
export const transportFailure = (status: number): RouteResponse =>
  ({ status, body: "upstream failure" });
```

The 200-with-errors test asserts **both halves in the same test** — that
`response.status === 200` and `response.ok === true`, *and* that the call rejected
with a typed `AcoError` — so the trap is visible in the test rather than implied by
its absence.

**`catalog-views.csv` — additive migration, existing consumers untouched.**

New header: `vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency`.
Nothing renamed, nothing dropped, the first four columns keep their exact positions.

Verified rather than assumed: `catalog-views.test.ts` is the only consumer in the
repository today, and its `parseCsv` maps values by header name
(`Object.fromEntries(columns.map(...))`), so appended columns are inert to it. Three
new synthetic constants go into `synthetic-identifiers.ts`, so there is still exactly
one source of truth and the audit script keeps covering them:

```ts
export const SYNTHETIC_CURRENCIES = ["EUR", "USD"] as const;
export const SYNTHETIC_AC_VIEW_ID_PREFIX = "acv-demo-" as const;
export const SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX = "acpb-demo-" as const;
```

Example row, all values synthetic:
`outdoor-gear,acme-demo-site-eu,en_US,outdoor_gear_eu_en,acv-demo-outdoor-gear-eu,acpb-demo-eur,EUR`.

The test is **extended, never replaced**. Both existing `it()` blocks stay
byte-identical. Three are added: an exact ordered header assertion; a prefix and
currency-membership assertion on the new columns; and — this one earns the rollback
plan — `expect(columns.slice(0, 4)).toEqual(["vertical", "site", "locale", "view_code"])`,
which is the additive guarantee written down, and which fails loudly on a partial
revert instead of silently mis-parsing.

**Cross-domain proof.** `packages/aco/src/cross-domain.test.ts` writes one row with
an `ac_view_id` via the ACO-side pure function and reads that same row through the
EDS-side config path, proving shared state rather than two compatible copies. This
requires `"@hiberus-magento/eds": "workspace:*"` as a **`devDependency`** of `aco`.
Rejected alternative: reimplement `eds`'s parse inside the test — that would prove a
copy is compatible with a copy, which is the exact failure the test exists to rule
out. `dependencies: {}` still holds in the published package, and
`scripts/verify-bundle.mjs` inspects the tarball, so the packaging gate is unaffected.

**The cold-start trigger, designed so "nothing happened" is not a possible outcome.**

1. `scripts/compare-bundle-size.mjs packages/aco/dist/mcp.js packages/eds/dist/mcp.js`
   prints byte sizes and the ratio.
2. If `|Δ| ≤ 20%`: append a dated note to
   `packages/mcp-testing/src/conformance/cold-start.ts` recording the measured ratio
   and explicitly retaining 250 ms, with the reason.
3. If `|Δ| > 20%`: the spec's own re-measure trigger has fired. Run
   `node scripts/measure-cold-start.mjs packages/aco dist/mcp.js` and record a new
   local-provisional number using the identical disclosed methodology (N = 20,
   discard 3, p95, `ceil(p95 × 1.75)` rounded up to the next 250 ms, marked
   PROVISIONAL, CI measurement still not performed).

Either branch edits `cold-start.ts`, so the check leaves an artifact whichever way
it goes.

**A trap found by reading `conformance.ts`:** `COLD_START_BUDGET_MS` is a single
module-level constant that `describeConformance` applies to **every** package
(line 305). If branch 3 fires, raising it would silently weaken `eds`'s budget.
Design response: in that case only, add an optional `coldStartBudgetMs` to
`ConformanceOptions`, defaulting to `COLD_START_BUDGET_MS`. Additive, and `eds`'s
assertion is unchanged because it passes no override.

---

## Data Flow

```
  MCP client (six tools)                      CLI operator (everything else)
      │ tools/call                                  │ argv — never a token
      ▼                                             ▼
  mcp.ts → tools/aco-tools.ts                  cli.ts  (stdin, env, formatting, exit codes)
   zod .strict() = the wire gate                     │
                    │                                │
                    ▼                                ▼
        ┌───────────────────────── client/index.ts ─────────────────────────┐
        │                    (the only public surface)                      │
        │                                                                   │
        │   operations/  ──►  MerchandisingTransport      AdminTransport     │
        │   (named docs)      (no tokenProvider field)    (tokenProvider)    │
        │                            │                          │           │
        │                     rate-limiter 10/s          rate-limiter 4/s   │
        │                            └────────┬─────────────────┘           │
        │                                     ▼                             │
        │                            http.ts :: readEnvelope                │
        │                        (the ONLY reader of `status`)              │
        │                                     │                             │
        │                        ┌────────────┴────────────┐                │
        │                 no GraphQL envelope         envelope present      │
        │                        ▼                         ▼                │
        │                 AcoTransportError        graphql.ts :: classify   │
        │                                          (NO status parameter)   │
        │                                                  │                │
        │                            ┌─────────────────────┴──────────────┐ │
        │                       errors[] non-empty                 errors absent
        │                            ▼                                    ▼ │
        │                 typed AcoError (throw)              ClassifiedData<T>
        │                                                              │     │
        │                                                     op.parse(data) │
        └───────────────────────────────────────────────────────────────────┘
```

### Sequence: admin credential selection, then a 200-that-is-a-failure

```
 CLI/MCP    credential-provider     MintedTokenProvider    AdminTransport   http   ACO
    │              │                        │                   │           │      │
    │─ getToken ──►│                        │                   │           │      │
    │              │ selectAdminProvider()                      │           │      │
    │              │   stored/env Bearer? ──► PastedBearerProvider           │      │
    │              │      decode created_at/expires_in (NO signature check)  │      │
    │              │      expired ──► CredentialExpiredError  ✗ no request sent
    │              │   else client id/secret? ─►│                │           │      │
    │              │                            │ POST ims/token/v3         │      │
    │              │                            │ grant_type=client_credentials    │
    │              │                            │ single-flight, generation-stamped│
    │              │◄── {value, expiresAt} ─────│                │           │      │
    │◄─ Credential ─│                                            │           │      │
    │                                                            │           │      │
    │────────────── execute(GraphQlOperation<"admin", T>) ───────►│           │      │
    │                                        rate-limiter 4/s ───►│──────────►│─────►│
    │                                                            │           │◄─ 200
    │                                                            │  readEnvelope
    │                                                            │  status = 200, ok = true
    │                                                            │  envelope has errors[]
    │                                                            │  ──► classify(envelope, op)
    │                                                            │      x-commerce-exception?
    │                                                            │      throttle-shaped?
    │                                                            │      scope-shaped?  (heuristic)
    │◄──────────── throw AdminScopeError (remedy names BOTH exits) ──────────────────│
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/aco/**` | Create | Scaffolded by `pnpm new-server aco`; template `noop`/`read-echo` tools removed; `private` dropped for publish |
| `packages/aco/src/client/index.ts` | Create | The only public surface — client factory, every error class, every result type |
| `packages/aco/src/client/graphql.ts` | Create | `ClassifiedData<T>` brand, `classify()`, the sole GraphQL-error construction site (Decision 1) |
| `packages/aco/src/client/errors.ts` | Create | `AcoError` hierarchy, `signalledBy`/`confidence` discriminants, `RetryableAcoError` |
| `packages/aco/src/client/http.ts` | Create | `readEnvelope()` — the only reader of `status`; two transports with different deps types |
| `packages/aco/src/client/headers.ts` | Create | `AcoHeaderName` union; admin and merchandising header assembly (Decision 2) |
| `packages/aco/src/client/rate-limiter.ts` | Create | Copy of EDS's sliding-window limiter; `ADMIN_PACE`/`MERCH_PACE` with the chosen-not-documented note |
| `packages/aco/src/client/retry.ts` | Create | EDS's pure policy over `RetryableAcoError`; required `idempotent` field |
| `packages/aco/src/client/cursor.ts` | Create | `ScrollPage<T>`; `priceBooks` only |
| `packages/aco/src/client/types.ts` | Create | Tolerant hand-written wire types + narrowing; `AcoSchemaMismatchError` producers |
| `packages/aco/src/client/operations/{channels,policies,price-books,scopes,search,facets,mutations}.ts` | Create | Named GraphQL documents, one module per family; `mutations.ts` is the only file containing `mutation ` |
| `packages/aco/src/client/provision.ts` | Create | The four-step pipeline as a pure function over injected values; dry-run default; CLI-only |
| `packages/aco/src/credential-provider.ts` | Create | `selectAdminProvider`, `PastedBearerProvider`, IMS `mint()`, ACO `Remedy` naming both exits |
| `packages/aco/src/cli.ts` | Create | `hiberus-aco`; `CLI_OPTIONS` table, stdin-only intake, `auth mint`/`auth status`, every CLI-only operation |
| `packages/aco/src/mcp.ts` | Create | `hiberus-aco-mcp`; six registrations; installs `createStdioServer()` |
| `packages/aco/src/tools/aco-tools.ts` | Create | The six schemas + factory; no side effects, so tests import it directly |
| `packages/aco/src/testing/fetch-double.ts` | Create | Operation-name route keys + the four GraphQL response helpers |
| `packages/aco/src/mcp.test-d.ts` | Create | Type-level proof that `mode` is exactly `"named"` |
| `packages/aco/src/cross-domain.test.ts` | Create | One shared `catalog-views.csv` row, written ACO-side and read EDS-side |
| `packages/aco/eslint-fixtures/deep-client-import.ts` | Create | Proves the client-boundary rule fires for this package |
| `packages/aco/fixtures/*.json` | Create | Synthetic GraphQL fixtures, values from `synthetic-identifiers.ts` |
| `packages/aco/package.json` | Create | `devDependencies` gains `@hiberus-magento/eds` (dev-only; `dependencies: {}` holds) |
| `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` | Modify | `SYNTHETIC_CURRENCIES`, `SYNTHETIC_AC_VIEW_ID_PREFIX`, `SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX` |
| `packages/mcp-testing/src/fixtures/catalog-views.csv` | Modify | Additive columns `ac_view_id,ac_price_book_id,currency` |
| `packages/mcp-testing/src/fixtures/catalog-views.test.ts` | Modify | Existing blocks unchanged; three assertions added, including the first-four-columns guard |
| `packages/mcp-testing/src/conformance/cold-start.ts` | Modify | Dated note recording the bundle-size comparison — in both branches of the trigger |
| `packages/mcp-testing/src/conformance/conformance.ts` | Modify | **Only if the >20% trigger fires**: optional `coldStartBudgetMs` on `ConformanceOptions` |
| `scripts/compare-bundle-size.mjs` | Create | Prints byte sizes and the ratio for the re-measure trigger |
| `openspec/specs/mcp-conformance/spec.md` | Modify | Delta owned by `sdd-spec`, not by this design |
| `servers.json`, `README.md` | Modify | `aco` entry with the six real tools; README regenerated, never hand-edited |
| `openspec/config.yaml` | Modify | `testing.projects` gains `aco` |
| `docs/aco-onboarding.md` | Create | The out-of-band Adobe Console / Studio steps, including "the mint may not work in your tenant" |

---

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit — error model | 200 + `errors[]` is a failure, asserting `status === 200` and `ok === true` in the same test | `graphQlErrors()` fixture + a rejection assertion |
| Unit — error model | `x-commerce-exception: "access-key-invalid"` → `CatalogViewAccessError` with a catalog-view remedy | One fixture, class + remedy asserted |
| Unit — error model | A scope failure's remedy contains **both** exit strings | Substring assertion on both |
| Unit — error model | A 429 with **no** envelope is `AcoTransportError`, never a throttle; a 200 with throttle-shaped extensions **is** a throttle | `transportFailure(429)` and `graphQlErrors([...])`, two distinct classes |
| Unit — error model | Partial (`data` + `errors`) rejects, and `hadPartialData` is `true` | `graphQlPartial()` fixture |
| Unit — retry | Throttle and transport retry; scope/access/operation/schema errors are not in the union | Table-driven + `retry.test-d.ts` |
| Unit — pacing | N requests never exceed the configured window | `vi.useFakeTimers()`, injected `now`/`sleep`, recorded send timestamps |
| Unit — credentials | Two concurrent calls with an expired token trigger exactly **one** IMS mint | Call-count assertion on the mint double |
| Unit — credentials | A pasted Bearer whose decoded `expires_in` has elapsed throws `CredentialExpiredError` **before** any request | Assert the fetch double was never called |
| Unit — credentials | `selectAdminProvider` precedence, all four input combinations | Pure function, table-driven |
| Unit — credentials | The merchandising path attaches no `Authorization`, and the stub access-token supplier's header is attached exactly once | Recorded-headers assertion |
| Unit — tiers (Decision 0) | With **no** admin credential resolvable, both Tier-A tools succeed and all four Tier-B tools return `isError: true` carrying `hiberus-aco auth token set` — no hang, no throw | Six `invoke()` calls against a fetch double and an empty config dir |
| Unit — tiers (Decision 0) | A live `AdminScopeError` is relayed as a caught, actionable `isError: true` result, not an uncaught exception, and Adobe's message survives in the text | `graphQlErrors([...])` on an admin route |
| Unit — tiers (Decision 0) | Recovery without restart: an expired stored Bearer fails a Tier-B call, the stored value is replaced, and the **next** call on the same client succeeds — proving the credential is re-read per call and never cached at startup | Two `invoke()` calls either side of a config-file rewrite |
| Unit — tiers (Decision 0) | All four Tier-B descriptions name the credential recovery; neither Tier-A description does | Description scan over `createAcoTools(...)` |
| Unit — pagination | `priceBooks` round-trips `scrollId` across two pages; no third request | Two fixtures + call count |
| Unit — schema fidelity | An unknown extra field passes through; a missing optional yields `undefined`; a missing keyed field throws `AcoSchemaMismatchError` naming operation and field | Three fixtures, one parser |
| Unit — purity | No `console.`, `process.exit`, `process.env`, prompt import, or ANSI escape under `client/` | Source scan, copied from `eds/src/client/purity.test.ts` |
| Unit — structure | `X-Auth-Token` appears nowhere under `packages/aco/src/**`; `mutation ` appears only in `operations/mutations.ts`; every document is a named operation | Three source scans |
| Type | `acoTogglePolicyInput["mode"]` is exactly `"named"`; `{ mode: "all" }` not assignable; an admin operation is not assignable to the merchandising transport | `mcp.test-d.ts` under `vitest --typecheck` |
| Runtime — gates | `safeParse` rejects `mode: "all"`, `names: []`, omitted `names`, unknown keys | Table-driven |
| Runtime — six tools | Exactly six names; no tool matches any CLI-only operation slug | Mirrors `eds/src/mcp.test.ts:49` |
| Runtime — facets | Non-facetable attribute returns `{ facetable: false, reason }` and issues exactly **one** request | Call-count assertion |
| Runtime — provision | Dry-run default issues zero mutations; second run issues none; step 1 with zero matches aborts before any write | Three call-count assertions |
| CLI | No option matches `/token\|key\|secret\|password/i`; `--token` exits 1; `auth status` never prints the Bearer | Option-table test + captured streams |
| Conformance | Six tools' metadata; `describeConformance` with **no** `shellOutProbe`; packaging gate; cold-start median; `mode.enum === ["named"]` in `tools/list` | Against the built bundle |
| Cross-domain | One `catalog-views.csv` row written ACO-side, read EDS-side | `cross-domain.test.ts` |
| Regression | `eds`'s existing suite stays green against the migrated fixture | `pnpm test` |

Every fixture value is imported from `synthetic-identifiers.ts`. Strict TDD: every
row above lands RED first.

---

## Threat Matrix

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, `README.sh` | **N/A** — `packages/aco` classifies no file as executable and executes nothing from disk | — | — |
| Git repository selection | `git -C`, relative/absolute paths | **N/A** — no VCS automation in this change | — | — |
| Commit state | staged, `commit -a`, empty index | **N/A** — no VCS automation | — | — |
| Push state | tracking branch, first push, refspec | **N/A** — no VCS automation | — | — |
| PR commands | `--head`, env prefix, composed commands | **N/A** — no PR automation | — | — |
| Subprocess stdio inheritance | child spawned with `stdio: "inherit"`; in-process `console.log`; raw `process.stdout.write` | **Applicable** — `hiberus-aco-mcp` is a stdio server, even though it spawns nothing | `mcp.ts` installs `createStdioServer()` and passes its `stdout` to the transport; the repo-wide eslint ban on `stdio: "inherit"` covers `packages/aco/src/**` | `describeConformance` with **no** `shellOutProbe`: the domain-independent fd-1 divert probe must find zero stray stdout lines |
| Credential in process arguments | `--token X`, `--token=X`, a positional Bearer | **Applicable** — a Studio Bearer is pasted by a human at a terminal | `parseCredentialCliArgs(argv)` before dispatch; the `setToken` handler has no token parameter; `CLI_OPTIONS` is a single exported table asserted to contain no secret-shaped name | `--token` and `--token=` both exit 1; the option table matches no `/token\|key\|secret\|password/i` |
| **Untrusted upstream text reaching the agent and the terminal** (added) | `errors[].message` containing shell metacharacters, ANSI escapes, a token-shaped string, or a path-traversal fragment | **Applicable** — Adobe's own error text is surfaced verbatim by design, on both adapters | The message is carried as a JSON string field and never interpolated into a command, a path, or a URL — `packages/aco` executes nothing, so there is no injection sink. The CLI renders it through `redact()` before writing to stderr | An `errors[]` message containing `;`, backticks, an ANSI escape and a token-shaped value round-trips as inert text through the MCP tool, and is redacted on the CLI path |

---

## Migration / Rollout

No runtime data migration. `packages/aco` is new and nothing depends on it.

The one shared touchpoint is `catalog-views.csv`, and the migration is strictly
additive: three columns appended, the first four unchanged in name and position.
The `expect(columns.slice(0, 4))` assertion makes a partial revert fail loudly
rather than mis-parse silently. Reverting the single commit restores the previous
shape exactly.

`servers.json` starts `status: "planned"` and flips to `"alpha"` in the final
commit, after the deliberate manual first publish. If a bad version reaches npm the
remedy is `npm deprecate` plus a patch — never unpublish-and-republish.

---

## Open Questions

- [ ] **The proposal's Merchandising-track rationale covers two of six tools, not
      six (Decision 0).** This design proceeds with a two-tier surface. Two sub-questions
      remain open, and neither blocks apply: (a) the orchestrator's parallel check of
      Adobe's Merchandising documentation for a `channels`/`priceBooks`/`policies`
      equivalent — if one exists, moving a tool is a one-literal change thanks to the
      track phantom type, but the proposal's own tool table would need amending;
      (b) whether `proposal.md` lines 63–65 should be amended to describe the two-tier
      reality rather than a single-track claim the table contradicts. `aco_toggle_policy`
      is settled either way: Merchandising is read-only, so a mutation cannot live there.
- [ ] **`AC-Scope-Locale` is CLI-observed, not doc-confirmed.** Adobe's Merchandising
      page documents four headers and does not name the locale header verbatim,
      while a companion limitations page confirms a locale header is required. It is
      therefore a single constant, `LOCALE_HEADER`, defined once in `headers.ts` with
      that provenance recorded, so a correction is a one-line change. Confirm against
      the real tenant during apply.
- [ ] **`x-api-key` / `x-gw-ims-org-id` necessity is unknown.** Both are optional in
      the Python CLI. Design: send each when configured, omit when not, and name
      their absence as a possible cause in `AdminScopeError`'s remedy. Confirm
      whether the tenant requires them, or whether omitting them is itself the scope
      failure the field notes describe.
- [ ] **Cold-start budget parameterisation is conditional.** `ConformanceOptions`
      gains an optional `coldStartBudgetMs` **only if** `aco`'s bundle differs from
      `eds`'s by more than 20%. If the trigger does not fire, that file is not
      touched. Confirm the measured ratio before editing `conformance.ts`.
- [ ] **`@hiberus-magento/eds` as a `devDependency` of `aco`.** Needed for the
      cross-domain test to exercise the real EDS-side reader rather than a copy.
      Dev-only, so `dependencies: {}` and the packaging gate are unaffected, but it
      is a domain→domain edge that did not exist before. Confirm before apply.
