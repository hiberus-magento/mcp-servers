# @hiberus-magento/aco

## 0.1.1

### Patch Changes

- Ships a README and the npm metadata the 0.1.0 page was missing. npm renders a package's page from the README inside the tarball and from nowhere else, so 0.1.0's page read "This package does not have a README", with no description, no keywords and no link back to the repository. The package now carries `description`, `keywords`, `repository` (with `directory`, so npm links to this package's own subfolder of the monorepo), `homepage`, `bugs`, `author` and `engines`, and the README is listed in `files`.

  The README's tool list, environment contract and client-configuration snippet are generated from `servers.json` by the same code path that generates the root README, and `node scripts/gen-readme.mjs --check` now covers them. The hand-written half states the Tier A / Tier B split, both base URLs being required together, and the two Developer Console traps that cost this programme real time.

  Corrects the configuration snippet. This package declares two binaries — `hiberus-aco` and `hiberus-aco-mcp` — and neither is named after the package's last path segment, which is the only name `npx` guesses, so the old `npx -y @hiberus-magento/aco@<version>` form could not start the server. The snippet now names the binary explicitly.

  No change to the tool surface or to any server behaviour.

## 0.1.0

### Minor Changes

- First release — an Adobe Commerce Optimizer client, shipped as the `hiberus-aco` CLI and the `hiberus-aco-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first.

  Six MCP tools span both of ACO's APIs. Catalog search and facet-value lookup go to the Merchandising API and need no credential at all against an unprotected catalog view. Listing catalog views, price books and policies, and toggling a single filter inside one policy, go to the admin API and need an admin Bearer — pasted from a Studio session via `ACO_TOKEN`, minted from `ACO_CLIENT_ID` and `ACO_CLIENT_SECRET`, or read from the file written by `hiberus-aco auth token set`.

  Alpha. The tool surface may change in any 0.x release, and whether a given tenant requires `ACO_API_KEY` or `ACO_IMS_ORG_ID` is still unconfirmed — both are sent when set and omitted when not.
