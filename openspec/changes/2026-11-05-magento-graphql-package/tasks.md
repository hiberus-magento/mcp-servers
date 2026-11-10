# Tasks

Strict TDD: each item is test first, red for the right reason, then code.

1. [ ] Scaffold with `pnpm new-server`; replace the template tools with the real entry points.
2. [ ] `client/operation-guard` (kind, count, depth, size, unreadable documents).
3. [ ] `client/errors`, `retry`, `rate-limiter`, `http`, `index`; `purity.test.ts`.
4. [ ] `credential-provider` (optional token), `tools/runtime`.
5. [ ] `tools/graphql-tool` factory; curated tools by group; generic `query` and `schema`.
6. [ ] `tools/index` (groups, write switch), `verification`.
7. [ ] `mcp.ts`, `cli.ts`, `tsup` entries, bins, conformance test on the built bundle.
8. [ ] `servers.json` entry, README, `docs/magento-graphql-onboarding.md`, licences, tests that tie them together.
9. [ ] Run against a real instance and move tools onto `LIVE_VERIFIED_TOOLS`.
