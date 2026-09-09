# Contributing

Thank you for considering a contribution to `mcp-servers`. This document covers the conventions this repository enforces structurally — please read it before opening a pull request.

## Getting Started

```sh
corepack enable
pnpm install
pnpm build
pnpm test
```

Requires Node.js `>=22` (see `.nvmrc`) and the pinned pnpm version from `packageManager` in the root `package.json`.

## Everyday Commands

| Command | What it does |
|---|---|
| `pnpm lint` | ESLint across every package plus root-level scripts |
| `pnpm typecheck` | `tsc --noEmit` across every package |
| `pnpm test` | Vitest per package (includes the CI-blocking conformance suite) plus root-level script tests |
| `pnpm build` | `tsup` bundles each server package |
| `pnpm verify:package` | The packaging gate (single-file bundle, size, forbidden dependencies, tarball shape) |
| `pnpm new-server <name> --domain <domain> --description "<text>"` | Scaffold a new server package from `templates/server/` |
| `node scripts/gen-readme.mjs` / `--check` | Regenerate or verify freshness of the generated section of `README.md` |
| `node scripts/check-licenses.mjs` / `--write` | Verify or regenerate a package's `THIRD-PARTY-NOTICES.txt` |

## Strict TDD

This repository was built under Strict TDD and expects contributions to follow the same discipline: write the failing test first, run it, confirm it fails for the right reason, then implement. See `packages/mcp-core/src/**/*.test.ts` for the established pattern (RED case documented in the test description, GREEN implementation in the sibling non-test file).

## Non-Negotiable: No Real Customer Data

This repository is public. Every fixture, test, example, and sample value MUST use synthetic organization, site, and domain identifiers — see `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` for the shared constants. Never commit a real customer name, org slug, production domain, or credential value anywhere: code, tests, fixtures, comments, docs, or commit messages. CI runs a synthetic-identifier audit (`scripts/audit-synthetic-identifiers.mjs`) and a secret scanner (`scripts/scan-secrets.mjs`) over every change, but these are backstops — review your own diff first.

## Architectural Boundaries (Enforced by Lint)

- **SDK boundary**: only `packages/mcp-core/src/**` may import `@modelcontextprotocol/sdk`'s barrel or `server/index.js` directly. Every other package goes through the `mcp-core` bootstrap.
- **Client boundary**: code outside a package's own `client/` directory must import another package's client surface only through its public `client/index.ts`, never a deeper path.
- **Exec boundary**: `packages/mcp-core/src/exec/**` is the only place `execFile` may be used, and prefix/regex-based command matching is banned there — allowlisting is by exact full subcommand only.
- **License header**: every source file needs the Apache-2.0 header comment at the top (see any existing file for the exact text).

## Adding a New Server Package

Run `pnpm new-server <name> --domain <domain> --description "<text>"`. This scaffolds `packages/<name>` from `templates/server/`, registers it in `servers.json`, and regenerates `README.md`. The template already passes the conformance suite unmodified — build your domain-specific tools on top of it, following the safety primitives `mcp-core` provides (stdout safety, `defineTool()`, the allowlisted executor, truncation/pagination, redaction, credential loading).

## Releases

This repository uses [changesets](https://github.com/changesets/changesets) for independent per-package versioning. Run `pnpm changeset` to record a change that should trigger a release before merging a pull request that touches a publishable package.

## Related Repositories

- [`hiberus-magento/ai-tools`](https://github.com/hiberus-magento/ai-tools) — skills and agents (knowledge, edited daily, not published as a package).
- [`hiberus-magento/hiberus-dockergento`](https://github.com/hiberus-magento/hiberus-dockergento) — the development environment that installs and wires this repository and `ai-tools` together.
