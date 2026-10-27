# Design: eds-write-surface — the full EDS Admin API write surface behind plan/apply

## Technical Approach

Three layers inside `packages/eds`, each testable on its own:

1. **Client** (`client/`) — new Admin API operations as plain functions returning plain objects,
   under the existing purity rules (`eds-client` spec, "Client Module Purity"). The client knows
   nothing about plans or tokens.
2. **Confirm** (`confirm/`) — a pure, in-memory plan store: issue a token for a plan, look it up,
   consume it once, expire it, compare fingerprints. It knows nothing about EDS; it stores opaque
   request lists and fingerprints.
3. **Tools** (`tools/eds-tools.ts`) — `eds_plan` builds a plan (reads through the client,
   computes the diff, fingerprints, warnings, confirmation message) and registers it in the
   store; `eds_apply` consumes a token, re-checks the fingerprint, replays the stored requests
   through the client, and returns the outcome.

Endpoints are taken from the Admin API OpenAPI contract (12.145.0) and `aem.live/docs/admin.html`.
Behaviours that are inferred rather than documented are marked as such, following `eds-package`.

## Architecture Decisions

### Decision 1: One `eds_plan` / `eds_apply` pair, operation as a discriminated union

`defineTool` requires a `ZodObject` (`eds-package` design, Decision 7), so the union is nested in
one field, exactly as `eds_reindex` already does:

```ts
const operation = z.discriminatedUnion("kind", [ /* one strict object per kind, below */ ]);

export const edsPlanInput = z.object({
  site: z.string().min(1),
  ref: z.string().min(1).optional(),     // content/index/code kinds only; default "main"
  operation,
}).strict();

export const edsApplyInput = z.object({
  token: z.string().min(1),
  confirmSite: z.string().min(1).optional(),
  wait: z.boolean().optional(),          // block until a job-backed operation completes
}).strict();
```

`wait` lives on `eds_apply` because it changes how the result is reported, never what is written.

**Operation kinds and the requests each plan records** (`nonEmptyPaths` is capped at 100, as
`eds_get_status_bulk` already is):

| `kind` | Extra fields | Requests recorded at plan time | Fingerprinted |
|---|---|---|---|
| `config.patch` | `patch: object` (RFC 7386 JSON Merge Patch) | `POST /config/{org}/sites/{site}.json` with the full merged document | site document |
| `site.create` | `config: object` | `PUT /config/{org}/sites/{site}.json` | existence (must still be 404) |
| `site.delete` | — | `DELETE /config/{org}/sites/{site}.json` | site document |
| `version.restore` | `versionId: string` | `POST /config/{org}/sites/{site}.json?restoreVersion={id}` | site document |
| `robots.set` | `content: string` | `POST /config/{org}/sites/{site}/robots.txt` (`text/plain`) | current `robots.txt` |
| `preview.update` / `preview.delete` | `paths` | one path: `POST`/`DELETE /preview/{org}/{site}/{ref}/{path}`; several: `POST /preview/{org}/{site}/{ref}/*` with `{ paths, delete? }` | no |
| `live.publish` / `live.unpublish` | `paths` | same shape under `/live/` | no |
| `index.update` / `index.delete` | `paths` | one path: `POST`/`DELETE /index/{org}/{site}/{ref}/{path}`; several (update only): `POST /index/{org}/{site}/{ref}/*` with exactly `{ paths }`; delete is per path | no |
| `index.full-site` | `confirmFullReindex: true` | `POST /index/{org}/{site}/{ref}/*` with **no body**, the contract's full-site reindex (D1) | no |
| `cache.purge` | `paths` | one `POST /cache/{org}/{site}/{ref}/{path}` per path | no |
| `sitemap.rebuild` | `path` | `POST /sitemap/{org}/{site}/{ref}/{path}` | no |
| `code.sync` / `code.delete` | `paths` | `POST`/`DELETE /code/{owner}/{repo}/{ref}/{path}`; `owner`/`repo` **resolved from the site's `code` block at plan time** | no |
| `job.stop` | `topic`, `name` | `DELETE /job/{org}/{site}/{ref}/{topic}/{name}` | no |
| `snapshot.add` / `.remove` / `.publish` / `.review` / `.delete` | `id`, `paths?`, `reviewAction?`, `message?` | as the existing snapshot client functions | no |

Twenty-two kinds. `key.create` and `key.delete` are deliberately absent (D2).

**Why `code.*` takes no `owner`/`repo`.** The original exclusion of `code` operations was that an
agent could easily target the wrong repository. Resolving the repository from the site's own
configuration at plan time removes that failure mode instead of removing the capability, and the
resolved `owner/repo` is shown in the confirmation message.

**Why there is no CDN write kind.** The existing client already records that this tenant answers
the CDN sub-document path with an undocumented `400` (`site-config.ts`,
`CDN_CONFIG_ABSENT_STATUSES`). CDN settings are part of the site document, so `config.patch`
covers them without depending on that endpoint.

### Decision 2: The plan store (`confirm/plan-store.ts`)

```ts
interface StoredPlan {
  readonly site: string;
  readonly kind: OperationKind;
  readonly requests: readonly PlannedRequest[];   // method, path, body, content type
  readonly fingerprint?: Fingerprint;             // { read: PlannedRequest; sha256: string }
  readonly protected: boolean;
  readonly expiresAt: number;
}
```

- **Token:** 32 random bytes from `node:crypto`, base64url. Unguessable; never derived from the
  plan contents, so it reveals nothing.
- **Lifetime:** 10 minutes from issue. The clock is injected so tests use fake time.
- **Single use:** a token is **consumed at the start of `eds_apply`**, before any request, whether
  the apply then succeeds, fails, or is rejected as stale. A failed apply requires a new plan.
  This rules out a retry loop silently re-issuing writes. The only check that runs before
  consumption is the protected-site `confirmSite` check (Decision 6), which reads and writes
  nothing.
- **Bounded:** at most 100 live plans; issuing one more evicts expired entries first and then the
  oldest. Plans live only in process memory: restarting the server invalidates every token, which
  is the safe direction.
- **No EDS knowledge:** the store never interprets a request. That keeps it promotable to
  `mcp-core` later without change.

### Decision 3: Stale-plan detection by fingerprint

For the kinds marked "fingerprinted", the plan records the read that produced the state shown to
the user and the SHA-256 of its canonical JSON (keys sorted, no whitespace). `eds_apply` repeats
that read and compares hashes before writing. On mismatch it writes nothing and returns
`{ status: "rejected", reason: "stale-plan" }` with a message asking for a new plan.

`site.create` fingerprints existence: the plan requires `GET` → 404, and so does the apply.
Content kinds are not fingerprinted: their effect does not depend on a document the user reviewed,
and fingerprinting them would require a bulk status job per plan.

### Decision 4: What `eds_plan` returns

```ts
type PlanResult =
  | { status: "no-changes"; site: string; summary: string }        // no token issued
  | {
      status: "planned";
      token: string;
      expiresAt: string;                 // ISO 8601
      site: string;
      kind: OperationKind;
      summary: string;                   // one line, e.g. "Update the configuration of acme-demo-site-eu"
      changes?: readonly ConfigChange[]; // config kinds: { pointer, before, after } per changed key
      requests: readonly { method: string; path: string }[];
      warnings: readonly string[];       // AEM, protected site, full-site reindex, deletion
      confirmationMessage: string;       // ready to show to the user verbatim
      instruction: string;               // see below
      requiresConfirmSite: boolean;
    };
```

The **instruction** is a fixed string, returned in every planned result, because a model weighs
what it has just received more than a tool description read at the start of the session:

> Show `confirmationMessage` to the user, translated into the user's language if needed, without
> summarising the changes away. Call `eds_apply` only if the user's most recent message explicitly
> confirms this plan. If the user asks for any modification, call `eds_plan` again; do not reuse
> this token.

The **confirmation message** is assembled by the server, not the model, so it is the same every
time: site, operation, resolved repository (for `code.*`), the changed keys with before/after (for
config kinds) or the path list, every warning, and the closing question. When
`requiresConfirmSite` is true it asks the user to reply with the site name.

All plan output passes through `mcp-core`'s `redact` before it is returned.

### Decision 5: What `eds_apply` returns

```ts
type ApplyResult =
  | { status: "applied"; site: string; kind: OperationKind; responses: readonly unknown[];
      job?: unknown; previousVersionId?: string }
  | { status: "rejected"; reason: "unknown-token" | "expired" | "used" | "stale-plan"
      | "confirm-site-missing" | "confirm-site-mismatch"; message: string }
  | { status: "pending"; message: string };   // reserved; never produced by this change
```

`previousVersionId` is the newest entry of `GET /config/{org}/sites/{site}/versions.json` read at
plan time, returned for config kinds so the user can be offered `version.restore`. **Inferred
only**: the contract documents the versions list but not that a `POST` creates a new version; the
field is reported as "the newest version before this change", not as a guaranteed rollback point.

`pending` is in the type now so that an out-of-band approval step can be added later without a
breaking change to the result shape. A test asserts nothing in this change produces it.

### Decision 6: Protected sites

`EDS_PROTECTED_SITES` is read by `mcp.ts` (never by `client/` or `confirm/`) and injected. It is a
comma-separated list of patterns where `*` is the only wildcard and matches any run of characters;
matching is case-sensitive and anchored. No regular expressions are accepted from the environment.

A plan whose site matches sets `requiresConfirmSite: true` and adds a warning. `eds_apply` then
requires `confirmSite` to equal the site name exactly; a missing or different value is rejected
**without consuming the token**, so the user can answer again without re-planning. (This is the one
rejection that does not consume: it happens before anything is read or written, and the token is
still bound to the same plan.)

### Decision 7: AEM content-source warning

For `preview.*` and `live.*`, the plan reads the site document and adds a warning when
`content.source.type` is `markup` and `content.source.url` contains `/bin/franklin.delivery` — the
AEM author delivery endpoint. The
warning says that previewing or publishing through the Admin API leaves no replication record in
AEM, so the author will not show the page as published, and that publishing from AEM is
preferable when an audit trail is required. **Heuristic**, not a documented field; see Open
Questions.

### Decision 8: `config.patch` semantics

RFC 7386 JSON Merge Patch: objects merge recursively, `null` removes a key, arrays and scalars are
replaced wholesale. Chosen because it is a published standard a model already knows, and because
the result is fully determined by the current document and the patch, so the plan can show the
exact document that will be sent. The implementation is a small pure function in `confirm/`
(no dependency).

The plan computes the merged document, diffs it against the current one by JSON Pointer, and:

- returns `no-changes` (and no token) when the diff is empty;
- rejects a patch that is not a JSON object;
- records the **full merged document** as the request body, so `eds_apply` sends exactly what was
  shown even if the merge implementation changed between the two calls.

### Decision 9: Client — create vs update

`putSiteConfig` is replaced by two functions, both keeping the GET-before-write discipline:

- `createSite(params, config)`: `GET` must return 404, then `PUT`. A 200 on the GET is an error
  naming the existing site; it never falls through to an update.
- `updateSiteConfig(params, config)`: `GET` must return 200, then `POST`.

The contract states `PUT` creates and `POST` updates; the previous single-`PUT` path would have
targeted an existing site with a create request.

### Decision 10: Removing three tools

`eds_set_live_state`, `eds_reindex` and `eds_manage_snapshot` are removed rather than kept beside
`eds_plan`. Keeping them would leave three writes that bypass confirmation, which is the exact gap
this change closes. Their hazard gates survive inside the operation union: `index.full-site`
still requires the literal `confirmFullReindex: true` (its request is now the documented bodyless
`POST`, D1), and every `paths` field is still
`nonEmptyPaths`.

## Alternatives Considered

| Alternative | Why not now |
|---|---|
| One `*_plan`/`*_apply` tool pair per operation | ~30 tools; context cost on every request; same reason `eds-package` rejected one tool per subcommand |
| MCP elicitation (server-driven confirmation dialog) | Client support varies; the package must behave identically in every client. The `ajv` stub in `mcp.ts` also makes elicitation results unvalidatable today. Can be added later as a convenience on top of the token |
| Out-of-band approval page on `127.0.0.1` | Strongest guarantee that a human approved, and client-independent, but adds an HTTP server, HTML escaping and CSRF hardening, and needs a browser on the server's machine. Reserved behind the `pending` result status |
| Plan store in `mcp-core` | `mcp-core` is private and bundled; no other package needs this yet. Promotion later is a move, not a rewrite |
| Keep the existing three write tools alongside plan/apply | Leaves unconfirmed writes on the surface |

## Data Flow

```text
user ── "change X on site S" ──► model
model ── eds_plan {site S, operation} ──► tools
tools ── GET site doc / versions / robots … ──► client ──► Admin API
tools ── diff + fingerprint + warnings + message ──► plan store ── token
model ◄── PlanResult (confirmationMessage, instruction, token)
model ── shows message, asks ──► user ── "yes" ──► model
model ── eds_apply {token, confirmSite?} ──► tools
tools ── consume token ──► plan store
tools ── re-read + compare fingerprint ──► client ──► Admin API
tools ── replay recorded requests ──► client ──► Admin API
model ◄── ApplyResult
```

## File Changes

| File | Action |
|---|---|
| `packages/eds/src/client/operations/site-config.ts` | Modify: `createSite`, `updateSiteConfig`, `deleteSite`, `listSites`, versions, restore |
| `packages/eds/src/client/operations/robots.ts` | New |
| `packages/eds/src/client/operations/preview.ts` | New (single + bulk) |
| `packages/eds/src/client/operations/live.ts` | Modify: single-path publish/unpublish beside the existing bulk |
| `packages/eds/src/client/operations/index-ops.ts` | Modify: single-path update/delete; bulk body `{ paths }`; full-site bodyless (D1) |
| `packages/eds/src/client/operations/cache.ts`, `sitemap.ts`, `code.ts`, `api-keys.ts` | New |
| `packages/eds/src/client/jobs.ts` | Modify: list, stop |
| `packages/eds/src/client/index.ts` | Modify: export the new surface |
| `packages/eds/src/confirm/plan-store.ts`, `fingerprint.ts`, `merge-patch.ts`, `protected-sites.ts` | New |
| `packages/eds/src/tools/plan.ts` | New: operation union, plan builders per kind, confirmation message |
| `packages/eds/src/tools/eds-tools.ts` | Modify: register `eds_plan`, `eds_apply`, new reads; remove three tools |
| `packages/eds/src/mcp.ts` | Modify: inject `EDS_PROTECTED_SITES`; pass `_meta["anthropic/requiresUserInteraction"]: true` when registering `eds_apply` (D3) |
| `servers.json`, `README.md`, `packages/eds/README.md`, `docs/eds-onboarding.md` | Modify |
| `.changeset/*.md` | New |

## Testing Strategy

All synthetic (`acme-demo-org`, `acme-demo-site-eu`, `acme-demo-site-us`), over the existing
`FetchDouble`; no live traffic. Strict TDD: each row starts as a failing test.

| Area | Key tests |
|---|---|
| Plan store | token is 32 bytes base64url; expiry under fake timers; consumed on first apply; reuse rejected; eviction at 101 plans |
| Write gate | for **every** operation kind: apply with missing, forged, expired, reused and stale token issues zero write requests (the double records none) |
| Replay | the requests issued by apply equal the requests recorded by plan, including body bytes |
| Fingerprint | canonical JSON is key-order independent; a changed remote document yields `stale-plan` and zero writes |
| Merge patch | RFC 7386 appendix examples; `null` removes; arrays replaced; non-object patch rejected; empty diff → `no-changes`, no token |
| Protected sites | pattern matching (`*`, anchoring, case); missing/mismatched `confirmSite` rejected without consuming the token |
| AEM warning | present for `preview.*`/`live.*` on an AEM-sourced site, absent otherwise |
| Client | `createSite` GET 404 → PUT; GET 200 → error, no PUT; `updateSiteConfig` GET 200 → POST; new endpoints' paths and methods |
| Surface | `tools/list` is exactly the fourteen names; annotations per the spec; removed tools absent; `pending` never produced |
| Redaction | a secret-shaped value in a site document does not appear in plan output |

## Threat Matrix

| Boundary | Adversarial cases | Response | RED tests |
|---|---|---|---|
| Model applies without user consent | plan then apply in one turn | instruction + message; documented per-client "always ask" settings (`client-matrix.md`). `destructiveHint` is correct metadata but no client prompts on it today. Not fully preventable server-side (stated in proposal) | instruction and message present in every planned result |
| Model alters the operation between plan and apply | apply with different site/paths | `eds_apply` accepts no operation fields; `.strict()` rejects extras | apply with extra fields rejected; replay equality |
| Token guessing or reuse | forged, reused, expired token | random 32-byte token, single use, TTL | write-gate tests |
| Concurrent edit | config changed after plan | fingerprint re-check | stale-plan test |
| Wrong repository for code ops | model supplies another owner/repo | no owner/repo input; resolved from site config | schema rejects `owner`/`repo` |
| Environment-supplied pattern abuse | regex metacharacters in `EDS_PROTECTED_SITES` | only `*` is special; everything else literal | `.` and `+` match literally |
| Secret leakage through plan output | API key ids, tokens in config | `redact` on all plan output | redaction test |
| Process restart | token from a previous process | store is in-memory | unknown-token after a fresh store |

## Migration / Rollout

Minor bump to `0.2.0` with a changeset describing the three removed tools and their replacement
operations. The README gains a migration table (`eds_set_live_state` → `live.publish` /
`live.unpublish`; `eds_reindex` → `index.update` / `index.full-site`; `eds_manage_snapshot` →
`snapshot.*`). Every new write kind carries the `unverified` marker in `servers.json` until it has
been exercised against a real tenant.

## Open Questions

Reviewed 2026-10-27 (task 1.2) against the code on `feat/eds-write-surface`, the OpenAPI contract
12.145.0 and the client matrix (`client-matrix.md`).

### Resolved

- [x] **AEM detection heuristic.** The contract's `content.source` is a `oneOf` of `google`,
      `onedrive` and `markup`; there is no AEM-specific type. AEM author is a `markup` source, so
      the URL is the only signal. **Kept**, tightened: the warning fires when `content.source.type`
      is `markup` **and** the URL contains `/bin/franklin.delivery`. Still a heuristic; 6.4 checks
      it on a real AEM-sourced site.
- [x] **Plan lifetime.** **Fixed at 10 minutes**, as the spec states. Not configurable: no consumer
      has asked, and a longer lifetime only widens the stale-plan window that the fingerprint
      already has to catch. Revisit only with evidence from 6.7.
- [x] **Org-level configuration** (`/config/{org}.json`). **Out of scope**, confirmed: every
      operation in this change is site-scoped and protected-site matching is by site name. An
      org-level write would need its own confirmation rule and is a separate change.
- [x] **Client behaviour matrix.** Recorded in `client-matrix.md` (task 0.2). No client reads
      `destructiveHint`; each needs an explicit per-tool rule. Feeds 5.3. The Threat Matrix row
      below is corrected accordingly.
- [x] **How `eds_apply` replays requests** (found in review). Tools may only import
      `client/index.ts`, and `http` is internal, so replay needs a client entry point.
      **Decision:** the client exports `sendPlannedRequest({ method, path, body?, contentType? })`,
      which accepts only `POST`/`PUT`/`DELETE` and returns the response as a plain object.
      `eds_apply` calls it once per recorded request, in order. The fingerprint re-read is the
      GET-before-write for `site.create`, so apply issues no second existence `GET`. `createSite` and
      `updateSiteConfig` remain as the typed client functions that the CLI and plan builders use.
      New task 2.15.

### Deferred to manual validation (Phase 6)

- [ ] **Config versions.** The contract lists and restores versions but does not say a `POST`
      creates one. `previousVersionId` stays "newest version before this change". Verified by
      6.2.
- [ ] **Secrets round-trip in `config.patch`** (found in review). The `POST` "stores new site
      configuration", meaning it replaces the document, so the plan correctly sends the full merged
      document. The document schema includes `secrets`, `tokens` and `apiKeys`. If `GET` returns
      those masked, sending them back would overwrite the real values. Until 6.2 proves the round-trip on a site that has
      secrets, a `config.patch` plan on a document that has a non-empty `secrets` or `tokens` key
      carries a warning naming them. New tasks 4.5b and 6.2b.

### Decided 2026-10-27 (accepted by the user; applied to the deltas)

- [x] **D1, full-site reindex body.** The contract says a bulk index `POST` **without a body**
      reindexes every published resource, and its body schema has only `paths`. The `{ scope }`
      bodies the client sent before were undocumented. **Decision:** `index.full-site` records
      the documented bodyless `POST` plus a full-site warning, and `index.update` sends exactly
      `{ paths }`. Plan/apply and the `confirmFullReindex: true` literal close the original hazard,
      which was an accidental bodyless call. The `eds-mcp` requirement "Full-Site Reindex Operation
      Requires the Literal Gate Field" is modified accordingly. Task 2.8b changes `index-ops.ts`.
- [x] **D2, `key.delete` scope.** API keys are org-level (`cli.ts`: the site-level path answers
      404), while `eds_plan` is site-scoped and protected-site matching is by site.
      **Decision:** `key.delete` is not an operation kind (22 kinds) and stays CLI-only beside
      `key create` and `auth mint`. `eds_list_api_keys` is an org-level read with no `site`
      field. `deleteApiKey` stays in the client for the CLI. `eds-mcp` requirement "API Key Writes
      Stay Off the MCP Surface" and the `eds-cli` delta were updated.
- [x] **D3, `_meta["anthropic/requiresUserInteraction"]` on `eds_apply`.** The Claude Code docs
      ("Require approval for a specific tool") say that with this key set, Claude Code prompts on
      every call, even in `auto` and `bypassPermissions` modes. It offers no "don't ask again" and
      ignores allow rules. In `dontAsk` mode, or via `--permission-prompt-tool`, the call is
      denied. **Decision:** `mcp.ts` passes it in the `eds_apply` registration only, in
      `packages/eds`; `defineTool` is unchanged. Other clients ignore it, and nothing depends on it:
      it is additive, so the "works in every client with nothing but `tools/call`" property holds.
      New `eds-mcp` requirement "eds_apply Requires User Interaction in Clients That Support It".

### Defects in the existing client found in review (fixed by this change)

- **Bulk unpublish sends the wrong body.** `setLiveState` posts `{ paths, state }`, but the contract's
  bulk body is `{ paths, delete?, forceUpdate?, forceAsync? }`, with no `state` field. An
  "unpublished" request is therefore at best ignored and at worst a publish. That is shipped
  behaviour of `eds_set_live_state` in `0.1.x`. `live.unpublish` must send `delete: true`. New task
  2.7b; the changeset and README migration note must mention it.
- **`codePath` has no `{ref}` segment.** The contract path is `/code/{owner}/{repo}/{ref}/{path}`.
  Task 2.10 adds it.
