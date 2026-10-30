<div align="center">

# mcp-servers

**MCP servers that let an AI agent operate Adobe Commerce and Edge Delivery Services — without handing it a shell.**

[![CI](https://github.com/hiberus-magento/mcp-servers/actions/workflows/ci.yml/badge.svg)](https://github.com/hiberus-magento/mcp-servers/actions/workflows/ci.yml)

Apache-2.0 · Node ≥ 22 · published to npm under `@hiberus-magento`

[Quickstart](#quickstart) · [Team setup](./docs/team-setup.md) · [How it is built](#how-it-is-built) · [Contributing](./CONTRIBUTING.md)

</div>

---

An agent that can reach a commerce estate is an agent that can break one. The
answer here is not a prompt asking it to be careful: every operation is a
named tool with a declared shape and an output budget it cannot exceed, and
the things an agent must never do are not forbidden by instruction — they are
absent from the code. A server that shells out resolves its commands through
an exact-match allowlist that is physically unable to prefix-match, and the
one that can run SQL will not run a statement it cannot fully parse.

They are ordinary [MCP](https://modelcontextprotocol.io) stdio servers, so any
MCP client can run them. Each ships as a single bundled file that declares no
runtime dependencies at all, so `npx` needs nothing installed first and
nothing is resolved from the registry at run time.

<!-- servers:start -->

## Servers

| Package | What it talks to | Version | Reference |
| --- | --- | --- | --- |
| [`@hiberus-magento/eds`](https://npmjs.com/package/@hiberus-magento/eds) | Edge Delivery Services (EDS) Admin API client — CLI and MCP server. | `0.1.1` · alpha | [README](./packages/eds/README.md) · [setup](./docs/eds-onboarding.md) |
| [`@hiberus-magento/aco`](https://npmjs.com/package/@hiberus-magento/aco) | Adobe Commerce Optimizer (ACO) admin and Merchandising API client — CLI and MCP server. | `0.1.1` · alpha | [README](./packages/aco/README.md) · [setup](./docs/aco-onboarding.md) |
| [`@hiberus-magento/magento-cloud`](https://npmjs.com/package/@hiberus-magento/magento-cloud) | Magento Cloud CLI wrapper — CLI and MCP server for read-only Magento Cloud project, environment, and database operations. | `0.1.1` · alpha | [README](./packages/magento-cloud/README.md) · [setup](./docs/magento-cloud-onboarding.md) |
| [`@hiberus-magento/aem-sites`](https://npmjs.com/package/@hiberus-magento/aem-sites) | AEM as a Cloud Service Sites author client — CLI and MCP server for pages, page properties, sheets, replication, Live Copies and page locks behind plan/apply. | `0.0.0` · alpha | [README](./packages/aem-sites/README.md) · [setup](./docs/aem-sites-onboarding.md) |

## Quickstart

Nothing to install first — each server is a single bundled file with no runtime dependencies, so `npx` fetches and runs it on its own. Add one to your MCP client's configuration; here `@hiberus-magento/eds`, and every other server in the table takes the same shape with its own package, binary and variables:

```json
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/eds@0.1.1",
        "hiberus-eds-mcp"
      ],
      "env": {
        "EDS_ORG": "${EDS_ORG}"
      }
    }
  }
}
```

Then see [team setup](./docs/team-setup.md) for which configuration file to put that in, and [`packages/eds/README.md`](./packages/eds/README.md) for this server's own tools and environment contract.

<!-- servers:end -->

Three details in that snippet are not decoration:

- **`--package <spec> <bin>`, never the bare `npx -y @hiberus-magento/eds`.**
  Each package declares two binaries — an operator CLI and the MCP server —
  and `npx` only ever guesses the one named after the package's last path
  segment. The bare form exits 1 with `could not determine executable to run`.
- **The version is pinned.** An MCP server is code your agent runs with your
  credentials; floating it is not a convenience.
- **`${EDS_ORG}`, not a literal.** Configuration files get committed. Secrets
  that live in them get committed too.

`magento-cloud` is the one server with an external requirement: it wraps the
upstream `magento-cloud` CLI, which must be on the `PATH` the MCP client gives
it. It reports that as a named error before spawning anything, rather than
failing mid-call.

**Setting these up for a team?** [`docs/team-setup.md`](./docs/team-setup.md)
is the page to read: which configuration file to use and which one must never
hold a secret, what each server actually needs, how to check it works from a
terminal before blaming the agent, and what every common failure message
means.

## Glossary

Three adjacent Adobe acronyms, routinely confused, which Adobe has renamed
before. They are **not** interchangeable.

- **EDS** — Edge Delivery Services: the publishing platform (preview/publish,
  indexing, code sync).
- **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS
  (drop-ins, components).
- **ACO** — Adobe Commerce Optimizer.

## How it is built

The shared safety primitives live in `packages/mcp-core`, and every server is
built on them. The pattern throughout is the same: make the unsafe thing
impossible to express, rather than documenting that nobody should write it.

- **A credential cannot reach shell history.** The credential CLI parser has
  no `--token` flag at all — not a rejected one, an absent one — and there is
  no function anywhere in `mcp-core` that reads a token out of `argv`. Tokens
  arrive on stdin or in an environment variable, and a stored credential file
  is refused outright if its mode is not `0600`.
- **An undeclared field cannot reach a caller.** Parsers project results
  field by field from a named allowlist rather than spreading the parsed
  object. A type annotation is a compile-time claim only; a spread would
  serialize whatever the upstream CLI decided to add this release. Each parser
  has a test that feeds it an extra column and asserts it is absent from
  `JSON.stringify` of the result — the form an agent actually receives.
- **stdout belongs to the JSON-RPC transport.** Writing to it corrupts the
  protocol stream, so logging goes to stderr. That is enforced twice: by lint
  (`no-console`, plus a ban on touching `process.stdout` directly), and at
  runtime by a bootstrap guard that captures the real `process.stdout.write`
  before application code can reach it, hands it only to the transport, and
  forwards everything else to stderr — which holds even for a write from
  bundled dependency code that lint never sees.
- **Commands are allowlisted by full subcommand, never by prefix or regex.**
  The allowlist is a `Map` keyed on the exact `[bin, ...subcommand]` string
  and resolved with `.get()`, so it structurally cannot prefix-match. `ssh`,
  `tunnel` and `db:dump` are rejected at *registration* time: a forbidden
  command cannot be constructed, so the process fails to boot rather than
  failing per call. Only `mcp-core/src/exec/` may call `execFile`, and
  `exec`/`execSync`/`spawnSync` are banned repository-wide.
- **The SQL guard rejects comments outright.** Not because comments are
  suspicious, but because MySQL and MariaDB *execute* version comments:
  `SELECT 1 /*!50000 , 2 */` was run against a live database and returned two
  columns. Anything inside one would be analysed as absent and run anyway, so
  a removed comment is reported and the query refused. Telling an executable
  comment from an inert one is a worse bet than refusing both.
- **Secret redaction is linear by construction.** One pre-compiled
  alternation, one `String.replace` pass, every quantifier on a disjoint
  character class with a bounded limit and none nested inside another — there
  is no backtracking path. The key set is closed and explicit, never an
  open-ended `\w+=` guess, and there is deliberately no environment variable
  that turns redaction off: that switch is exactly what a compromised
  environment would set.
- **No tool can return unbounded output.** `defineTool` truncates as a
  backstop even when a tool's author forgot pagination, cutting at a UTF-8
  character boundary and appending a marker that names how many bytes were
  kept out of how many existed.

## How it is kept true

Two gates run on every build, and both exercise a real server rather than a
mock:

- **A conformance suite** (`packages/mcp-testing`) spawns the built server
  over stdio and asserts the protocol contract: every tool carries complete
  metadata, the version announced over the protocol is the one in
  `package.json`, a read-only tool's registered commands all fall inside its
  declared read allowlist, and stdout stays pure JSON-RPC — including an fd-1
  contamination probe that calls a tool which shells out, because a child
  process inherits fd 1 whatever the parent promised.
- **A packaging gate** (`scripts/verify-bundle.mjs`, G1–G9) packs each package
  and inspects the tarball: every declared binary maps to exactly one bundled
  file under 2 MB, zero forbidden dependencies survived bundling, the tarball
  declares no dependencies, shebangs are intact, LICENSE and README are
  present, and build metadata is not shipped.

Both run against `packages/fixture-server`, a private harness generated from
`templates/server/`. A test regenerates it and diffs byte-for-byte against the
committed files, so "a freshly scaffolded server passes conformance
unmodified" stays continuously true instead of having been true once.

On top of that, CI runs lint, typecheck, the full test suite, a build, schema
validation of [`servers.json`](./servers.json), a staleness check on this file
and every package README, a licence allowlist with a third-party notices
freshness check, a secret scan over the diff, and a synthetic-identifier audit
that reads every human-authored text file in the repository — this one is
public, so no real customer name, org slug or business-shaped domain may
appear anywhere in it, tests and comments included.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/<server>/` | One published server each — see the table above. |
| `packages/mcp-core/` | The shared safety primitives every server is built on. Private. |
| `packages/mcp-testing/` | The CI-blocking conformance suite. Private. |
| `packages/fixture-server/` | The generated harness both gates exercise. Private, never published. |
| `templates/server/` | The scaffold a new server is generated from. |
| [`servers.json`](./servers.json) | The manifest. The servers table and quickstart above are generated from it. |
| [`docs/`](./docs) | Team setup and a per-server onboarding guide. |
| [`openspec/`](./openspec) | The specifications every package was built from, and the archived design documents recording why. |

The section between the `servers:start` / `servers:end` markers above is
generated by [`scripts/gen-readme.mjs`](./scripts/gen-readme.mjs) — do not
hand-edit it. Run `node scripts/gen-readme.mjs` after changing `servers.json`;
CI fails on a stale copy. Everything outside the markers is hand-written and
is preserved verbatim.

## Adding a new server

```sh
pnpm new-server <name> --domain <domain> --description "<description>"
```

This scaffolds the package from [`templates/server/`](./templates/server),
registers it in `servers.json` and regenerates this README in one step — which
is why the manifest, the front page and the packages that actually exist
cannot drift apart. Never hand-scaffold one.

## Contributing

[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the everyday commands and the house
rules; [`AGENTS.md`](./AGENTS.md) for the same contract written for an AI
coding agent. The short version: strict TDD, no real customer data ever, and
the architectural boundaries are enforced by lint rather than by convention.

## Related repositories

- [`hiberus-magento/ai-tools`](https://github.com/hiberus-magento/ai-tools) —
  skills and agents. Knowledge that is edited daily; not published as a
  package.
- [`hiberus-magento/hiberus-dockergento`](https://github.com/hiberus-magento/hiberus-dockergento)
  — the development environment that installs and wires this repository and
  `ai-tools` together.

## License

Apache-2.0. See [LICENSE](./LICENSE).
