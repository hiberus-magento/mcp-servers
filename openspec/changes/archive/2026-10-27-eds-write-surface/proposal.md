# Proposal: eds-write-surface — the full EDS Admin API write surface behind plan/apply

## Intent

`eds-package` shipped `hiberus-eds-mcp` with nine tools: six reads and three writes
(`eds_set_live_state`, `eds_reindex`, `eds_manage_snapshot`). Everything else an operator does
against the Admin API every week — create or delete a site, change its configuration, restore a
configuration version, preview content, purge the cache, rebuild a sitemap, sync code, stop a job,
set `robots.txt` — was placed on a CLI-only exclusion list. Most of those exclusions were never
implemented in the CLI either (`eds-cli` spec, "CLI-Only Operations Excluded from MCP"), so in
practice the operations are not available on either surface.

Reviewing that list against the departmental use case, the reasons recorded for it fall in two
groups:

1. **Project-specific orchestration** — "needs local site-model context an MCP call has no
   business carrying". This reason is correct and is **kept**: generating a site document from a
   customer's own site model, applying it to dozens of sites, or wiring an external catalogue is
   project logic. It does not belong in a departmental package.
2. **Generic Admin API primitives judged too risky for an agent** — create, delete, configure,
   restore, purge, sync. The risk is real, but an exclusion list is the wrong answer to it: it
   removes the capability without making the remaining writes any safer (the three existing write
   tools execute on the first call, with no review step at all).

This change replaces the exclusion list with a single, uniform safety mechanism, and exposes the
generic primitives behind it:

- **Every write goes through `eds_plan` → user confirmation → `eds_apply`.** `eds_plan` is
  read-only: it computes exactly what would change and returns it, with a ready-to-show
  confirmation message and a one-time token. `eds_apply` accepts **only that token** and executes
  exactly what was planned — nothing the model can alter between the two calls.
- **The confirmation is the user's reply in the conversation.** It works in every MCP client
  (Claude Code, GitHub Copilot, opencode, …) because it uses nothing beyond `tools/call`. No
  client-specific capability is required. `eds_apply` additionally carries Claude Code's
  `requiresUserInteraction` marker, which makes Claude Code prompt on every call; other clients
  ignore it, and nothing depends on it (design.md D3).
- **The package stays generic.** It exposes the Admin API as it is, for any EDS project; the
  knowledge of what a given project's site document should contain lives in that project's own
  repository (a skill or agent instructions that compose `eds_plan` operations).

## Scope

### In Scope

**`packages/eds` only.** No change to `mcp-core`, `mcp-testing`, `fixture-server` or any other
server package (see Approach, "Why everything stays in `packages/eds`").

- **Client** (`packages/eds/src/client/`): new operations for site create/delete/list, config
  update, config versions (list/restore), `robots.txt` (read/write), preview (update/delete,
  single and bulk), cache purge, index delete, sitemap rebuild, code status/sync/delete, job
  list/stop, and API key list/delete. Fix the existing `putSiteConfig`, which always sends `PUT`
  even for an existing site.
- **Confirmation** (`packages/eds/src/confirm/`): the plan store — one-time, expiring tokens bound
  to the site, the exact requests to issue and, for configuration operations, a fingerprint of
  the remote state at plan time.
- **MCP surface** (`packages/eds/src/tools/`, `mcp.ts`):
  - `eds_plan` (read-only) and `eds_apply` (destructive).
  - New reads: `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`,
    `eds_get_code_status`, `eds_list_jobs`, `eds_list_api_keys` (metadata only).
  - **Removed:** `eds_set_live_state`, `eds_reindex`, `eds_manage_snapshot`. Their operations move
    into `eds_plan` so that no write anywhere bypasses confirmation.
- **Protected sites:** `EDS_PROTECTED_SITES`, a comma-separated list of site-name patterns. A plan
  against a matching site requires the user to repeat the site name, and `eds_apply` must echo it.
- **AEM content-source warning:** preview/publish plans on a site whose content source is an AEM
  author warn that the Admin API path leaves no replication record in AEM.
- `servers.json`, the generated README, `docs/eds-onboarding.md` (client permission settings per
  client), and a changeset (minor bump, `0.1.x` → `0.2.0`, since three tools are removed).

### Out of Scope

- **Project-specific orchestration**, unchanged from `eds-package`: generating site documents from
  a site model, multi-site apply, DNS, Cloud Manager, AEM author packages, and any shared
  catalogue CSV. Those belong to the consuming project.
- **AEM author replication** (publishing through AEM's own replication API). Different API,
  different credential; a possible future package. This change only *warns* that it is the
  preferable path for AEM-sourced sites.
- **`key create`, `key delete` and `auth mint` stay CLI-only.** The created key value is returned
  exactly once; over MCP it would land in the model's context and transcript. Key deletion has no
  such issue, but API keys are an org-level resource and do not fit `eds_plan`'s site-scoped
  input or protected-site matching (design.md D2). `eds_list_api_keys` is an org-level read.
- **Out-of-band approval** (a local approval page) and **MCP elicitation**. Both were considered
  (see design.md, "Alternatives considered"). Neither ships now; the `eds_apply` result shape
  reserves a `pending` status so either can be added later without a breaking change.
- Any change to the CLI's command surface other than removing the stale exclusion requirement.

## Capabilities

### Modified Capabilities

- `eds-mcp`: the tool surface changes from nine tools to fourteen; every write moves behind
  `eds_plan`/`eds_apply`; new requirements for the plan token, the confirmation message,
  protected sites and the AEM warning.
- `eds-client`: new operations; the existing config-write requirement is tightened so creation
  uses `PUT` only after a `GET` returns 404 and an update of an existing site uses `POST`.
- `eds-cli`: the "CLI-Only Operations Excluded from MCP" requirement shrinks to the three
  operations that stay CLI-only (`key create`, `key delete`, `auth mint`).

## Approach

### One plan/apply pair instead of one tool per write

Splitting each write into its own `*_plan` and `*_apply` tool would add roughly thirty tools and
burn context on every request — the same reason `eds-package` rejected one tool per subcommand.
Instead `eds_plan` takes `{ site, operation }`, where `operation` is a discriminated union of every
supported write, and `eds_apply` takes `{ token, confirmSite? }`.

Because `eds_apply` receives only a token, **the model cannot apply anything other than what the
user was shown**. The planned requests are stored server-side and replayed verbatim.

### Confirmation that works in every client

The guarantee is layered, and the proposal is explicit about where each layer stops:

| Layer | What it guarantees | Where it stops |
|---|---|---|
| Token | Nothing is written without a plan; exactly the planned requests are issued; a stale, expired or reused token is rejected | Does not prove a human said yes |
| Confirmation message + instruction in the plan result | The model receives a ready-made message to show and an explicit instruction not to apply without an explicit "yes" in the user's latest message | Relies on the model following the instruction |
| Per-client "always ask" setting for `eds_apply` | A second, client-side prompt in Claude Code, Copilot and opencode (`client-matrix.md`). `destructiveHint: true` is set, but no client prompts on it by itself | Needs per-client configuration; some client modes bypass it |
| Protected sites | The user must type the site name; `eds_apply` rejects a mismatched or missing `confirmSite` | Same reliance on the model as the message |

This is deliberately **not** sold as a barrier against a model that is determined to bypass it —
nothing inside an MCP server can be, since such a model with shell access could read the
credential file directly. It closes the realistic failure: an eager model chaining plan and apply
without asking, or applying something different from what it described.

### Why everything stays in `packages/eds`

`mcp-core` is private and bundled into each package at build time; nothing outside this
repository consumes it. Placing the plan store there would buy reuse that no other package has
asked for yet, at the cost of widening the review to every server. The store has no dependency on
anything EDS-specific, so promoting it to `mcp-core` later is a move, not a rewrite.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/eds/src/client/operations/` | Modified + New | New operation modules; `site-config.ts` gains create/update split |
| `packages/eds/src/client/index.ts` | Modified | New operations on the public client surface |
| `packages/eds/src/confirm/` | New | Plan store, fingerprinting, protected-site matching |
| `packages/eds/src/tools/eds-tools.ts` | Modified | `eds_plan`, `eds_apply`, six new reads; three write tools removed |
| `packages/eds/src/mcp.ts` | Modified | Reads `EDS_PROTECTED_SITES`; registers the new surface |
| `packages/eds/src/**/*.test.ts`, `fixtures/` | New + Modified | Strict-TDD suite; synthetic identifiers only |
| `packages/eds/README.md`, `docs/eds-onboarding.md` | Modified | New surface, confirmation flow, per-client "always ask" settings |
| `servers.json`, `README.md` | Modified | Tool list; README regenerated, never hand-edited |
| `.changeset/` | New | Minor bump of `@hiberus-magento/eds` |
| `openspec/specs/eds-mcp`, `eds-client`, `eds-cli` | Modified | Deltas in this change |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A model applies without asking the user | Medium | Token + instruction in the plan result; documented per-client "always ask" settings. Out-of-band approval reserved as a follow-up if it happens in practice |
| A plan goes stale (someone else edits the config between plan and apply) | Medium | Configuration operations fingerprint the remote document; `eds_apply` re-reads and rejects on mismatch |
| Breaking change for current users of the three removed tools | Low (package is `alpha`, `0.1.x`) | Minor bump, changeset note, README migration section |
| New endpoints are contract-only, not verified against a live tenant | High | Every new operation carries the `unverified` manifest marker until exercised; the manual validation run is the last task |
| Config output shown to the model contains sensitive values | Low | Plan diffs and config reads pass through `mcp-core`'s `redact` |
| `cdn` sub-document behaviour differs from the documented contract (the existing client already records an undocumented `400`) | Medium | No dedicated CDN write: CDN settings are changed through `config.patch` on the site document only |

## Rollback Plan

Everything lands on a branch. Before publish, rollback is abandoning it. After publish, `npm
deprecate` `0.2.0` pointing back at `0.1.1` and ship a patch; never unpublish-and-republish.

## Dependencies

- `eds-package` (archived).
- No new runtime dependency; `dependencies: {}` still holds.

## Success Criteria

- [ ] `tools/list` returns exactly the fourteen tools in the `eds-mcp` delta; no write tool other
      than `eds_apply` exists.
- [ ] No Admin API write request is issued by any code path that did not receive a valid,
      unexpired, unused token — proven by a test that drives every operation kind through
      `eds_apply` with a missing, forged, expired, reused and stale token.
- [ ] `eds_apply` issues exactly the requests recorded at plan time, byte for byte.
- [ ] A configuration plan returns the before/after of every changed key; a no-op patch returns
      "no changes" and no token.
- [ ] A plan against a protected site cannot be applied without a matching `confirmSite`.
- [ ] A preview/publish plan on an AEM-sourced site carries the AEM warning.
- [ ] Site creation sends `PUT` only after a `GET` returns 404; a config update of an existing site
      sends `POST`.
- [ ] All gates in `AGENTS.md` pass; every fixture uses synthetic identifiers.
