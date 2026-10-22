# @hiberus-magento/magento-cloud

## 0.1.1

### Patch Changes

- Ships a README and the npm metadata the 0.1.0 page was missing. npm renders a package's page from the README inside the tarball and from nowhere else, so 0.1.0's page read "This package does not have a README", with no description, no keywords and no link back to the repository. The package now carries `description`, `keywords`, `repository` (with `directory`, so npm links to this package's own subfolder of the monorepo), `homepage`, `bugs`, `author` and `engines`, and the README is listed in `files`.

  The README's tool list, environment contract and client-configuration snippet are generated from `servers.json` by the same code path that generates the root README, and `node scripts/gen-readme.mjs --check` now covers them. The hand-written half states the upstream `magento-cloud` CLI prerequisite, that this server needs nothing in a client's configuration because it defers to that CLI's own session, and the three named failure shapes.

  Corrects the configuration snippet. This package declares two binaries — `hiberus-magento-cloud` and `hiberus-magento-cloud-mcp` — and neither is named after the package's last path segment, which is the only name `npx` guesses, so the old `npx -y @hiberus-magento/magento-cloud@<version>` form could not start the server. The snippet now names the binary explicitly.

  No change to the tool surface or to any server behaviour.

## 0.1.0

### Minor Changes

- First release — a read-only wrapper around the `magento-cloud` CLI, shipped as the `hiberus-magento-cloud` CLI and the `hiberus-magento-cloud-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first. The upstream `magento-cloud` CLI must already be installed and authenticated; `MAGENTO_CLOUD_CLI_TOKEN` is optional, and without it the CLI's own stored session is used.

  All nine MCP tools are read-only: authentication status, projects and their environments, environment configuration facets (service endpoints are returned without their credentials), deployment activities and one activity's full log, and a bounded diagnostic database query limited to a single guarded `SELECT`, `SHOW`, `DESCRIBE` or `EXPLAIN`. Nothing in this package deploys, scales, or writes to an environment.

  Alpha. The tool surface may change in any 0.x release.
