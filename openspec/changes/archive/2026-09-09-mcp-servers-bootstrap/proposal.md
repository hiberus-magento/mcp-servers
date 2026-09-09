# Proposal: mcp-servers-bootstrap — monorepo scaffolding and shared policy libraries

## Intent

The repository is empty. Four MCP server packages must ship independently to public npm under `@hiberus-magento`, each a single bundled file with `dependencies: {}`, runnable via `npx` with no prior install. Every one of them needs the same non-negotiable safety properties: stdout reserved exclusively for JSON-RPC, allowlisted external commands, redacted secrets, and credentials loaded from env/config rather than prompted. Building those properties per package guarantees they drift and that the weakest package sets the security floor. This change creates the workspace, the release pipeline, and the two internal libraries (`mcp-core`, `mcp-testing`) that make those properties structural instead of aspirational — with **no domain logic**.

## Roadmap (Deliverable A — the whole programme)

| # | Change | Goal | Depends on | Main risks | Done when |
|---|--------|------|-----------|------------|-----------|
| 1 | `mcp-servers-bootstrap` | Workspace, CI/release, `mcp-core`, `mcp-testing`. No domain logic. | — | Bundle-size gate fails; boundary rules unenforceable | Empty template server passes conformance and publishes a single-file dry-run tarball |
| 2 | `eds-package` | `hiberus-eds` CLI + `hiberus-eds-mcp` server. Simplest auth: static API key via `X-Auth-Token` / `Authorization: token <key>`. **Mints real API keys** (`POST /config/{org}/sites/{site}/apiKeys.json`) rather than porting the Python devtools-token workflow. | 1 | Key value returned once and never retrievable — UX must make loss explicit; undocumented Admin API traps (job GET returns 202, PUT-creates/POST-updates, 503 with `(429)` in `X-Error` means content-source throttling) | Task-shaped tool set green under conformance; **cold-start timing threshold measured and fixed here** |
| 3 | `aco-package` | `hiberus-aco` CLI + MCP server. | 1 | The `commerce.aco.admin` scope and Studio admin GraphQL endpoint are **not publicly documented** — reverse-engineered, short-lived hand-pasted Bearer | Merchandising read tools green; admin writes confined to CLI |
| 4 | `magento-cloud-package` | Adobe Commerce Cloud MCP server, **written from scratch** against the audit as a behavioral specification. | 1 | Audit-informed rewrite is not literally clean-room (see Risks) | 18-tool read-only surface reimplemented with its own Strict-TDD tests |
| 5 | `dockergento-integration` | Not yet understood. | 1, own exploration | Zero source material examined | Its own `sdd-explore` completes first |

**Ordering: validated, with one correction and one addition.**
- The exploration argued step 4 might be *lower*-effort than step 3 because it is "port + relicense". The confirmed rewrite decision **removes that head start**: only design effort stays low (the tool surface is validated), while implementation and tests are full cost under Strict TDD.
- Conversely, step 3 is *cheaper* than the exploration estimated: the Merchandising half of the ACO API uses a long-lived **restricted access key** independent of the fragile admin Bearer, and catalog reads are what an agent actually needs. **Build the ACO MCP server on the Merchandising track and confine the admin Bearer to the CLI for writes.** (Recorded here for change 3; not designed in this change.)
- Net: efforts 3 and 4 converge; the sequence stays 1→2→3→4→5, because 2 is still decisively the cheapest auth and pays down the conformance suite's cold start first.

## Scope (Deliverable B — this change)

### In Scope

**Workspace**: `pnpm-workspace.yaml`; root `package.json` with pinned `packageManager` (corepack) and `engines.node >= 22`; `.nvmrc`; `turbo.json`; shared `tsconfig`; `.gitignore`; `.editorconfig`.

**Quality gates**: eslint flat config with (a) `no-restricted-imports` enforcing the client boundary — adapters may import only `client/index.ts`, never deep paths — and (b) a license-header rule. `vitest` run from the root through turbo.

**Release**: `changesets` initialized for independent versioning under `@hiberus-magento`, `access: public`, `provenance: true`. `.github/workflows/ci.yml` (install, lint, typecheck, test, build, conformance, license allowlist) and `release.yml` (changesets publish, `id-token: write` + `contents: write`, **OIDC trusted publishing preferred over a long-lived `NPM_TOKEN`**), both `ubuntu-latest`. **Secret scanning in CI** — this repo is public.

**Governance**: root `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `CODEOWNERS`, `AGENTS.md`, generated `README.md`.

**Manifest**: `servers.json` + `schema/servers.schema.json` + the generator that produces `README.md` from the manifest (never hand-written). `templates/server/` scaffold plus a `pnpm new-server` generator.

**`packages/mcp-core`** — the shared policy library:

1. **Server bootstrap where stderr logging is by construction.** stdout is the protocol channel; a stray `console.log` corrupts JSON-RPC opaquely. Writing to stdout outside the transport must be structurally impossible, not merely discouraged.
2. **`defineTool()`** — zod schema, mandatory description, mandatory MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Missing annotations **fail to compile**, not at runtime.
3. **Allowlisted external-command executor** — `execFile` only, never `exec`; allowlisted by **full subcommand**, never by prefix, never by regex; every argument schema-validated; `timeoutMs` and `maxOutputBytes` required. Forbidden outright: `ssh`, `tunnel`, any `--` passthrough, `db:dump`. Core contract from the audit: **a validator must never validate a normalized copy and then execute the raw string — it returns the exact string that will be executed.**
4. **Output truncation** with an explicit truncation marker, plus pagination as a tool parameter.
5. **Secret redaction** in logs and error messages — deliberately linear-time (anti-ReDoS), covering key/value pairs and `scheme://user:pass@host` URLs, with a backtracking-safety test. Behavior and test reproduced; **written fresh**.
6. **Credential loading** — precedence **env var > config file**, persisted to `$XDG_CONFIG_HOME/hiberus/<domain>.json` at mode `0600`. **No native keychain dependency ever** (it breaks single-file bundling). A `TokenProvider` interface with per-domain implementations. Tokens are accepted via stdin or env only — **never as a command-line argument**, which would land in shell history.

**`packages/mcp-testing`** — the conformance suite, **blocking CI from day one**, asserting: the server answers `tools/list`; **nothing but JSON-RPC ever reaches stdout**; every tool has a description, a valid schema, and annotations; `readOnlyHint` tools invoke nothing outside the read allowlist; the published tarball has `dependencies: {}`, a preserved shebang, and an included `LICENSE`. Also owns `catalog-views.csv` as a **shared synthetic fixture** — it is a cross-domain contract, not either package's property.

### Out of Scope

- Any domain logic, tool, client, or credential for EDS, ACO, magento-cloud, or Dockergento.
- The **cold-start time threshold** — deliberately deferred. Every structural check blocks now; the timing threshold is measured and fixed in `eds-package`.
- A separate research phase (not selected).
- Python, any native module, any keychain integration, any HTTP/SSE MCP transport.
- Publishing real versions to npm (the release workflow is wired and dry-run-verified only).

## Capabilities

### New Capabilities
- `workspace-scaffolding`: pnpm/turbo/tsup/tsconfig/vitest/eslint wiring, Node 22 engines pin, boundary and license-header lint rules.
- `release-pipeline`: changesets independent versioning, CI and release workflows, OIDC trusted publishing, per-package `THIRD-PARTY-NOTICES.txt`, license allowlist, secret scanning.
- `server-manifest`: `servers.json` + JSON Schema, generated README, `templates/server/` and `pnpm new-server`.
- `mcp-core`: stdout-safe bootstrap, `defineTool()`, allowlisted command executor, truncation/pagination, redaction, credential precedence and `TokenProvider`.
- `mcp-conformance`: the CI-blocking conformance suite and shared synthetic fixtures.

### Modified Capabilities
None — greenfield repository, no existing specs.

## Approach

Build outside-in from the constraints that cannot be retrofitted. Packaging comes first: a throwaway stdio-only template server is bundled and its tarball inspected **before** any `mcp-core` API is designed, because a failed `dependencies: {}` gate changes the SDK strategy and therefore the bootstrap API. Then `mcp-core` is written under Strict TDD, each of its six primitives specified by a failing test first. `mcp-testing` is written against the template server, so the suite has a green subject from the moment it starts blocking CI. `servers.json` and the README generator land last, once there is a real package shape to describe.

Type-level enforcement is preferred over runtime checks wherever the constraint is knowable at compile time (annotations, tool schemas); lint enforcement where it is structural (import boundaries, license headers); CI enforcement where it is only observable in the artifact (tarball shape, bundle size, licenses, secrets).

**Every fixture, test, doc, and example uses synthetic org/site/domain names.** No real customer identifier enters this repository.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml`, `package.json`, `.nvmrc`, `turbo.json`, `tsconfig*.json` | New | Workspace and build graph |
| `eslint.config.js` | New | Boundary + license-header rules |
| `.changeset/` | New | Independent versioning, public access, provenance |
| `.github/workflows/ci.yml`, `release.yml` | New | Gates and OIDC publishing |
| `LICENSE`, `CONTRIBUTING.md`, `CODEOWNERS`, `AGENTS.md`, `README.md` | New | Apache-2.0 governance; README generated |
| `servers.json`, `schema/servers.schema.json`, `scripts/` | New | Single manifest + generator |
| `templates/server/` | New | `pnpm new-server` scaffold |
| `packages/mcp-core/` | New | Shared policy library |
| `packages/mcp-testing/` | New | Conformance suite + `catalog-views.csv` fixture |
| `openspec/config.yaml` | Modified | `testing.status` → implemented; `projects` populated |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **`@modelcontextprotocol/sdk` bundle bloat** — it depends on express, hono, cors, jose, ajv because it supports transports beyond stdio; `dependencies: {}` depends on tree-shaking actually dropping them | High | **Blocking build-size verification task with a concrete gate**: the bundled template server must be a single file **≤ 2 MB** whose contents contain **zero** occurrences of `express`, `hono`, `cors`, `jose`, `ajv`, and whose tarball declares `dependencies: {}`. Fallback ladder if it fails: (a) deep-path import of the stdio transport only, (b) esbuild alias-stub the HTTP transports, (c) vendor a minimal JSON-RPC stdio implementation into `mcp-core`. The gate runs in CI on every build, not once. |
| **Real customer data leaking into a public repo** — the Python CLI trees embed the customer domains, org names, backend hosts and verticals in their own constants | High | Synthetic identifiers mandated everywhere; CI secret scanning added in this change; no Python source is copied into this repo at all. |
| **Live credential files** may exist at `~/.eds-secrets.json` / `~/.aco-secrets.json` | Medium | **No SDD phase may open, copy, or reference them by value.** Nothing in this change reads `$HOME`. |
| **Clean-room caveat** — the `magento-cloud` rewrite is informed by an audit of Juan Cinto's MIT-licensed work, so it is **not literally clean-room**. Crediting the original author remains the safer path; the user chose the rewrite knowingly. | Medium | Recorded here as an accepted, user-owned decision. Carry no original expression. If any surviving expression is later identified, add a `THIRD-PARTY-NOTICES.txt` attribution rather than argue independence. |
| Conformance suite blocking CI on day one with only a template server could stall work on trivial gaps | Medium | Structural assertions only; the timing threshold is deferred to `eds-package` precisely so no arbitrary number blocks day one. |
| OIDC trusted publishing unavailable for the scope/registry | Low | Fall back to a short-lived scoped `NPM_TOKEN` in the release job only, documented as a temporary deviation. |

## Rollback Plan

Greenfield with zero commits and zero published versions, so rollback is cheap and total. All work lands on a branch; abandoning it leaves `master` empty. Nothing is published — the release workflow is verified by dry run only, so no version exists for a consumer to pin and no npm unpublish window is involved. If the bundle-size gate fails all three fallbacks, stop before `eds-package` and reopen the packaging constraint as its own change rather than weakening `dependencies: {}` silently.

## Dependencies

- Public npm access for the `@hiberus-magento` scope, and GitHub Actions OIDC trust configured for trusted publishing.
- Node 22 LTS and corepack-managed pnpm.
- `@modelcontextprotocol/sdk` and `zod` (both MIT, inside the allowlist `MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD`).

## Success Criteria

- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes from a clean clone on Node 22.
- [ ] The bundled template server is a single file ≤ 2 MB containing none of `express`/`hono`/`cors`/`jose`/`ajv`, and its `npm pack` tarball declares `dependencies: {}` with a preserved shebang and an included `LICENSE`.
- [ ] The conformance suite blocks CI and passes against the template server, including the assertion that nothing but JSON-RPC reaches stdout.
- [ ] A tool declared without `readOnlyHint`/`destructiveHint`/`idempotentHint` fails `tsc`, demonstrated by a type-level test.
- [ ] The command executor rejects a prefix-matched subcommand, an unallowlisted argument, `--` passthrough, and `db:dump`.
- [ ] Redaction masks key/value secrets and `scheme://user:pass@host` URLs, with a backtracking-safety test proving linear-time behavior.
- [ ] Credential loading resolves env over config file and writes `$XDG_CONFIG_HOME/hiberus/<domain>.json` at mode `0600`; no token is ever accepted as a CLI argument.
- [ ] `pnpm new-server` produces a package that passes conformance unmodified.
- [ ] `README.md` is generated from `servers.json` and CI fails if the committed README is stale.
- [ ] CI secret scanning and the license allowlist both run and can fail the build.
- [ ] `openspec/config.yaml` `testing.status` becomes `implemented` and `pnpm test` genuinely runs.
