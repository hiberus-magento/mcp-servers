# @hiberus-magento/magento-cloud

## 0.1.0

### Minor Changes

- First release — a read-only wrapper around the `magento-cloud` CLI, shipped as the `hiberus-magento-cloud` CLI and the `hiberus-magento-cloud-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first. The upstream `magento-cloud` CLI must already be installed and authenticated; `MAGENTO_CLOUD_CLI_TOKEN` is optional, and without it the CLI's own stored session is used.

  All nine MCP tools are read-only: authentication status, projects and their environments, environment configuration facets (service endpoints are returned without their credentials), deployment activities and one activity's full log, and a bounded diagnostic database query limited to a single guarded `SELECT`, `SHOW`, `DESCRIBE` or `EXPLAIN`. Nothing in this package deploys, scales, or writes to an environment.

  Alpha. The tool surface may change in any 0.x release.
