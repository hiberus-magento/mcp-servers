# mcp-servers

MCP (Model Context Protocol) servers for Adobe Commerce and Edge Delivery Services tooling, published independently to npm under `@hiberus-magento`. Every server is a single bundled file with no runtime dependencies, runnable via `npx` with no prior install.

The sections below the marker are generated from [`servers.json`](./servers.json) by [`scripts/gen-readme.mjs`](./scripts/gen-readme.mjs) — do not hand-edit them. Run `node scripts/gen-readme.mjs` to regenerate after changing `servers.json`; CI fails if the committed file is stale (`node scripts/gen-readme.mjs --check`).

<!-- servers:start -->

## Glossary

These three acronyms are adjacent, are **not** the same thing, and Adobe has renamed them before — do not treat them as interchangeable.

- **EDS** — Edge Delivery Services: the publishing platform (preview/publish, indexing, code sync).
- **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS (drop-ins, components).
- **ACO** — Adobe Commerce Optimizer.

## Related Repositories

- [`hiberus-magento/ai-tools`](https://github.com/hiberus-magento/ai-tools) — skills and agents. Knowledge that is edited daily; not published as a package.
- [`hiberus-magento/hiberus-dockergento`](https://github.com/hiberus-magento/hiberus-dockergento) — the development environment that installs and wires this repository and `ai-tools` together.

## Servers



### @hiberus-magento/eds

Edge Delivery Services (EDS) Admin API client — CLI and MCP server.

- Domain: eds
- Status: internal
- Binary: `hiberus-eds-mcp`

Tools:

- `noop` (read-only) — A no-op tool used only to exercise the packaging gate.
- `read-echo` (read-only) — Echoes a message back through an allowlisted read-only subprocess call, proving stdout stays pure JSON-RPC even though a child process is spawned.

<!-- servers:end -->

## Adding a New Server

Run `pnpm new-server <name> --domain <domain> --description "<description>"` to scaffold a new package from [`templates/server/`](./templates/server), register it in `servers.json`, and regenerate this README.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
