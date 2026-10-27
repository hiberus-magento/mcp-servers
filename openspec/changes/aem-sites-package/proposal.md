# Proposal: aem-sites-package — an MCP server for the AEM as a Cloud Service Sites author

## Intent

The `eds` server operates the Edge Delivery Services Admin API. It does not, and should not,
operate the AEM Sites author: that is a different API, host and credential. This change adds a
separate server for the author; **`packages/eds` is not touched**.

For a site whose content source is an AEM Sites author (Universal Editor / XWalk), the Admin API
is the wrong place to make content changes: it can push a page to `*.aem.page` / `*.aem.live`,
but it cannot create the page, change its properties, or leave a replication record in AEM. The
author is the source of truth, and today every operation on it is either manual (Sites console)
or lives in a project-specific Python CLI outside this repository.

The operations that CLI proved against a real author, and that operators repeat weekly, are:

- list a site's pages (QueryBuilder) and map them to public EDS paths;
- publish / unpublish pages through Replication (`/bin/replicate`, `preview` and `publish`
  agents) — the API equivalent of *Quick Publish*, which on an EDS-connected author also
  propagates to EDS live;
- write page-level metadata, in particular **blocking indexing** (`noindex, nofollow`) either per
  page or site-wide through the EDS bulk `metadata` sheet;
- create a sheet page from a template and edit its rows (Sling POST + CSRF token).

This change adds a new package, **`@hiberus-magento/aem-sites`**, that exposes those operations —
and the page lifecycle around them (create, copy, move, delete) — with the **same plan/apply
safety model** `eds` already ships, so an agent can operate the author without a console session
and without the ability to write anything the user did not see.

## Scope

### In Scope

- **New package `packages/aem-sites`**, scaffolded with `pnpm new-server aem-sites --domain
  aem-sites`. Two binaries: `hiberus-aem-sites` (operator CLI) and `hiberus-aem-sites-mcp`.
- **Client** (`src/client/`): typed operations over the classic author endpoints already proven
  in the field — QueryBuilder, Sling GET (`.N.json`), Sling POST servlet, `/bin/wcmcommand`,
  `/bin/replicate`, `/libs/granite/csrf/token.json` — each behind an operation function, never a
  generic "call this URL" escape hatch.
- **Write guard** (`src/guard/`): write roots, a closed page-property allowlist and a hard ban on
  Sling POST suffix operators the model could smuggle in (`@MoveFrom`, `@CopyFrom`, `:operation`,
  …) — design.md D4.
- **MCP surface**: eight read tools + `aem_plan` / `aem_apply` (design.md D1, spec `aem-sites-mcp`).
- **Credentials**: one bearer token per environment (Developer Console *local development
  token*), stored and checked exactly as the field CLI's `eds aem auth` does (design.md D6).
- **Protected environments and paths**: `AEM_PROTECTED_ENVS`, `AEM_PROTECTED_PATHS` — same
  "repeat the name" confirmation as `EDS_PROTECTED_SITES`.
- `servers.json` entry, generated README, `docs/aem-sites-onboarding.md`, changeset (`0.1.0`,
  status `alpha`).

### Independence from `eds`

- No change to `packages/eds`, and no dependency on any open `eds` branch or PR. The package is
  branched from `main`.
- The plan/apply confirmation (plan store, fingerprint, protected-pattern matcher) is implemented
  **inside `packages/aem-sites/src/confirm/`**, following the same pattern as `eds` but without
  importing it (design.md D2). Only primitives already on `main` in `mcp-core` are used
  (credentials, redaction, truncation, `defineTool`, stdout guard).

### Out of Scope

- **Project-specific orchestration**: which content tree belongs to which EDS site, MSM branch
  layout, multi-site batch runs, the generation of FileVault packages from a project's sample.
  That stays in the consuming project (a skill composing `aem_*` and `eds_*` tools).
- **Calling the EDS Admin API from this package.** Cross-system flows (e.g. publish the
  `metadata` sheet in AEM, then preview/live `/metadata.json` in EDS) are composed by the agent
  across the two servers; neither server imports the other's client.
- **Assets / DAM, Content Fragments, Experience Fragments, workflows, MSM rollout/sync, language
  copies, launches, scheduled (on/off time) publication.** Candidates for later changes.
- **Package Manager upload/install and arbitrary content import** (`:operation=import`). Deferred
  to a follow-up change behind an explicit opt-in (design.md, "Deferred").
- **Service credentials / OAuth server-to-server / JWT exchange.** Token only (design.md D6).
- **Users, groups, ACLs, OSGi, `/apps`, `/libs`, `/conf` writes.** Absent from the code, not
  merely disallowed.

## Capabilities

### New Capabilities

- `aem-sites-client`: typed author operations, write guard, credential exchange, retry policy.
- `aem-sites-mcp`: the ten-tool surface, plan/apply, protected environments and paths.
- `aem-sites-cli`: operator commands (`auth`, `pages list`, `plan`, `apply`), credential storage.

### Modified Capabilities

- `server-manifest`: new `aem-sites` entry.

## Approach

- **One package per API, one credential per package.** AEM author and EDS Admin API differ in
  host, authentication and failure modes; folding AEM into `eds` would put two credentials in one
  server and break the "every tool talks to one API" rule the repo keeps elsewhere.
- **Classic endpoints first, OpenAPI where it is proven.** Adobe's OpenAPI-based Sites APIs do not
  (as far as verified for this proposal) cover page create/move, page properties and replication
  with the coverage the classic endpoints have; the classic endpoints are what the field CLI
  already exercised against a live author. Every operation records which endpoint it uses so a
  later swap to an OpenAPI endpoint is local to one operation (design.md D3).
- **Same safety model as `eds`**: plan (read-only, returns diff + confirmation message + one-time
  token) → user says yes → apply (replays exactly the stored requests, after re-checking a
  fingerprint of what the user reviewed).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/aem-sites/` | New | Client, guard, confirm (plan store), credentials, tools, CLI, tests |
| `servers.json`, `README.md` | Modified | New entry; README regenerated |
| `docs/aem-sites-onboarding.md`, `docs/team-setup.md` | New / Modified | Credentials, env vars, client "always ask" settings |
| `.changeset/` | New | `@hiberus-magento/aem-sites` 0.1.0 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sling POST can write any property on any node | High if unguarded | Write roots + property allowlist + suffix-operator ban, enforced in the client before a request is built (D4) |
| A model applies without asking | Medium | Identical layered confirmation to `eds` (token, message, per-client "always ask") |
| Local development token expires (24 h) mid-session | High | Named `AemAuthError` with the `auth token set --env` remedy; token re-read on every call, so renewing needs no restart (D6) |
| Endpoint behaviour differs per author (409 right after creating a page, 400 when publishing right after preview) | Observed | Bounded retry policy encoded from the field findings (D7) |
| `cq:robotsTags` not rendered into `<meta name="robots">` by the EDS XWalk pipeline | Unknown | `page.set-robots` carries the `unverified` marker until Phase 6 validates it; the metadata-sheet path is the proven fallback |
| Publishing to `publish` also publishes to EDS live | Observed (feature) | Stated in the confirmation message of every `page.publish` plan |
| Public repo leaks a customer identifier | Low | Synthetic identifiers only; audit script runs in CI |

## Rollback Plan

New package, nothing else modified: before publish, abandon the branch. After publish,
`npm deprecate` the version. No other server is affected.

## Dependencies

- `main` as it is today (`mcp-core` credentials, redaction, tool definition, conformance suite).
- No dependency on `packages/eds` or on any open PR.
- No new runtime dependency.

## Success Criteria

- [ ] `tools/list` returns exactly the ten tools in `aem-sites-mcp`; `aem_apply` is the only writer.
- [ ] No author write request is issued by any code path without a valid, unexpired, unused token
      (missing / forged / expired / reused / stale token tests for every operation kind).
- [ ] No write request can target a path outside `AEM_WRITE_ROOTS`, nor carry a property name
      outside the allowlist or a Sling suffix operator — proven by property-based tests.
- [ ] A metadata-sheet `noindex` plan and a `page.publish` plan validated against a real author
      (Phase 6), with the EDS propagation observed and recorded.
- [ ] All gates in `AGENTS.md` pass; every fixture uses synthetic identifiers.
