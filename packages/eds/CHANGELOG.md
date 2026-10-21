# @hiberus-magento/eds

## 0.1.0

### Minor Changes

- First release — an Edge Delivery Services Admin API client, shipped as the `hiberus-eds` CLI and the `hiberus-eds-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first.

  Nine MCP tools cover a site's publishing surface: per-path and bulk status, publish and unpublish, the full effective site configuration, re-indexing, the audit log, snapshot reads and writes, and job polling. The credential is read from `EDS_TOKEN` or from the `0600` file written by `hiberus-eds auth token set` — never from a command-line flag, because a flag value lands in shell history. Key minting, code sync, cache purge and version restore are deliberately absent from the MCP surface and stay with a human at the terminal.

  Alpha. The tool surface may change in any 0.x release, and `eds_set_live_state` has not yet been exercised against a live Edge Delivery Services site — see its tool description and `docs/eds-onboarding.md` for what that does and does not mean.
