# Agent Instructions

Instructions for AI coding agents (and human contributors following the same discipline) working in this repository.

## What This Repository Is

A pnpm/turbo monorepo publishing independent MCP (Model Context Protocol) servers to public npm under `@hiberus-magento`. `packages/mcp-core` is the shared safety-primitives library every server builds on; `packages/mcp-testing` is the CI-blocking conformance suite; `packages/fixture-server` is a private, never-published harness generated from `templates/server/` that both the packaging gate and the conformance suite exercise on every build. See `README.md` for the glossary distinguishing EDS/ACS/ACO and links to the sibling repositories.

## Before You Write Any Code

1. Read `openspec/changes/*/design.md` and `specs/*/spec.md` for the change you are working on if one exists — this repository was built under SDD (spec-driven development) and the design documents record load-bearing decisions (why the SDK is imported only via deep paths, why `execFile` never `exec`, why redaction is linear-time, etc.). Do not silently deviate from a recorded decision.
2. Run `pnpm install && pnpm build && pnpm test` to confirm a clean baseline before changing anything.

## Non-Negotiable Rules

- **No real customer data, ever.** This repository is public. Every fixture, test, example, and sample value MUST use the synthetic identifiers in `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`. Never write a real customer name, org slug, production domain, or credential value anywhere — code, tests, fixtures, comments, docs, README examples, or commit messages.
- **Strict TDD.** Write the failing test first, run it, confirm it fails for the right reason (not a typo or import error), then implement. Do not write production code before its test exists and fails.
- **Respect the architectural boundaries** — they are enforced by lint, not convention:
  - Only `packages/mcp-core/src/**` may import `@modelcontextprotocol/sdk`'s barrel or `server/index.js` directly.
  - Code outside a package's own `client/` directory may import another package's client surface only through `client/index.ts`.
  - Only `packages/mcp-core/src/exec/**` may call `execFile`; `exec`/`execSync`/`spawnSync` are banned repo-wide; prefix/regex command matching is banned under `src/exec/**`.
  - Every source file needs the Apache-2.0 license header comment at the top.
- **stdout is the JSON-RPC transport for every server.** Never `console.log` or write to `process.stdout` directly in a server package — use the `mcp-core` logger, which writes to stderr. This is also enforced by lint, but understand why: a stray write corrupts the protocol stream.
- **Never a CLI credential argument.** `mcp-core`'s credential CLI parser has no `--token` flag at all — tokens are read from stdin or an environment variable only, never argv (shell history).

## Verifying Your Work

Run, in order, before considering a change complete:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:package
node scripts/gen-readme.mjs --check
node scripts/check-licenses.mjs
node scripts/audit-synthetic-identifiers.mjs
```

If you touched `servers.json`, also run `node scripts/gen-readme.mjs` (no `--check`) to regenerate `README.md`, and re-run `pnpm build` before `node scripts/check-licenses.mjs --write` if a package's bundled dependencies changed.

## Adding a New Server Package

Use `pnpm new-server <name> --domain <domain> --description "<text>"` — never hand-scaffold a package. It copies `templates/server/`, registers the package in `servers.json`, and regenerates `README.md` in one step, so the manifest and the README can never drift from what actually exists.
