# @hiberus-magento/aco

## 0.1.0

### Minor Changes

- First release — an Adobe Commerce Optimizer client, shipped as the `hiberus-aco` CLI and the `hiberus-aco-mcp` stdio MCP server. Each binary is a single bundled file with no runtime dependencies, so `npx` runs it with nothing installed first.

  Six MCP tools span both of ACO's APIs. Catalog search and facet-value lookup go to the Merchandising API and need no credential at all against an unprotected catalog view. Listing catalog views, price books and policies, and toggling a single filter inside one policy, go to the admin API and need an admin Bearer — pasted from a Studio session via `ACO_TOKEN`, minted from `ACO_CLIENT_ID` and `ACO_CLIENT_SECRET`, or read from the file written by `hiberus-aco auth token set`.

  Alpha. The tool surface may change in any 0.x release, and whether a given tenant requires `ACO_API_KEY` or `ACO_IMS_ORG_ID` is still unconfirmed — both are sent when set and omitted when not.
