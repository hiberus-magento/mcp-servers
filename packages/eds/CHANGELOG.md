# @hiberus-magento/eds

## 0.2.0

### Minor Changes

- 7e29024: Every change to an Edge Delivery Services site now goes through one reviewed path. `eds_plan` changes nothing and returns:

  - the exact requests, plus every changed configuration key with its value before and after;
  - the warnings;
  - a confirmation message assembled by the server;
  - a one-time token.

  The user confirms, and `eds_apply`, which takes only that token, sends exactly the planned requests. Tokens expire after ten minutes and work once. A plan whose configuration or `robots.txt` changed in the meantime is refused without writing. `EDS_PROTECTED_SITES` lists sites for which the user must also type the site name. `eds_apply` is marked `anthropic/requiresUserInteraction`, so Claude Code asks before every call; `docs/eds-onboarding.md` gives the setting for VS Code Copilot and opencode.

  `eds_plan` covers 22 operation kinds, including the ones 0.1 left out of the MCP surface:

  - site configuration (RFC 7386 merge patch), site create and delete, and configuration version restore;
  - `robots.txt`;
  - preview;
  - cache purge and sitemap rebuild;
  - code sync and delete, with the repository read from the site's own configuration;
  - stopping a job.

  There are six new read tools: `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`, `eds_get_code_status`, `eds_list_jobs` and `eds_list_api_keys`, the last one returning metadata only. Creating and deleting API keys stays off the MCP surface.

  **Breaking:** `eds_set_live_state`, `eds_reindex` and `eds_manage_snapshot` are removed. Their operations are `live.publish`/`live.unpublish`, `index.update`/`index.full-site` and `snapshot.*` in `eds_plan`. The package README has a migration table.

  **Fix:** 0.1's `eds_set_live_state` with `unpublished` on several paths sent the bulk job without `delete: true`; `live.unpublish` sends it.

  Alpha. Only `snapshot.add` and `snapshot.delete` have run against a live site. Every other new operation is built from the Admin API contract and is marked unverified in its tool description.

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
