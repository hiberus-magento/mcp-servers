# @hiberus-magento/eds

## 0.1.1

### Patch Changes

- Ships a README and the npm metadata the 0.1.0 page was missing. npm renders a package's page from the README inside the tarball and from nowhere else, so 0.1.0's page read "This package does not have a README", with no description, no keywords and no link back to the repository. The package now carries `description`, `keywords`, `repository` (with `directory`, so npm links to this package's own subfolder of the monorepo), `homepage`, `bugs`, `author` and `engines`, and the README is listed in `files`.

  The README's tool list, environment contract and client-configuration snippet are generated from `servers.json` by the same code path that generates the root README, and `node scripts/gen-readme.mjs --check` now covers them — a hand-maintained second copy of the manifest would drift the first time a tool was added.

  Corrects the configuration snippet. This package declares two binaries — `hiberus-eds` and `hiberus-eds-mcp` — and neither is named after the package's last path segment, which is the only name `npx` guesses. Measured against the real packed tarball, the `npx -y @hiberus-magento/eds@<version>` form the old snippet told people to paste exits 1 with "could not determine executable to run". The snippet now names the binary: `npx -y --package @hiberus-magento/eds@<version> hiberus-eds-mcp`.

  No change to the tool surface or to any server behaviour.

## 0.1.0

### Minor Changes

- First release — an Edge Delivery Services Admin API client, shipped as the `hiberus-eds` CLI and the `hiberus-eds-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first.

  Nine MCP tools cover a site's publishing surface: per-path and bulk status, publish and unpublish, the full effective site configuration, re-indexing, the audit log, snapshot reads and writes, and job polling. The credential is read from `EDS_TOKEN` or from the `0600` file written by `hiberus-eds auth token set` — never from a command-line flag, because a flag value lands in shell history. Key minting, code sync, cache purge and version restore are deliberately absent from the MCP surface and stay with a human at the terminal.

  Alpha. The tool surface may change in any 0.x release, and `eds_set_live_state` has not yet been exercised against a live Edge Delivery Services site — see its tool description and `docs/eds-onboarding.md` for what that does and does not mean.
