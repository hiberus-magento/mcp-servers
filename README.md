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
- Status: alpha
- Binary: `hiberus-eds-mcp`

Tools:

- `eds_get_status` (read-only) — Use this when you need one path's current status across edit/preview/live/code/index on a single site — the smallest, cheapest status call.
- `eds_get_status_bulk` (read-only) — Use this when you need status for several paths on a site at once instead of calling eds_get_status in a loop.
- `eds_set_live_state` — Use this to publish or unpublish one or more paths on a site. Destructive: it changes what is publicly live. **Not verified against a live service** — Never run against a live Edge Delivery Services site. The Admin API publishes content that already exists rather than creating it; the site this package was developed against keeps its content in AEM as a Cloud Service, and the package ships no preview operation, so there was no page that could be published safely. Its request shape is covered by unit tests and by the conformance suite.
- `eds_get_site_config` (read-only) — Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance.
- `eds_reindex` — Use this to re-run indexing for specific paths, or — only with explicit double confirmation — the entire site. **Not verified against a live service** — Never run against a live Edge Delivery Services site, at either scope.
- `eds_get_audit_log` (read-only) — Use this to review recent changes to a site. Returns one page of entries plus a nextToken cursor.
- `eds_get_snapshots` (read-only) — Use this to list a site's snapshots, or to inspect one by id.
- `eds_manage_snapshot` — Use this to add paths to a snapshot, remove them, publish it, submit a review decision, or delete it. **Not verified against a live service** — Partly run against a live Edge Delivery Services site: the add and delete verbs were exercised as a reversible pair. The publish, review and remove verbs were not.
- `eds_get_job_status` (read-only) — Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned earlier by eds_set_live_state or eds_reindex.

Environment:

- `EDS_ORG` (required) — The Edge Delivery Services organisation every eds_* tool addresses. The server resolves it on the first tool call and refuses the call without it; tools/list still works.
- `EDS_TOKEN` (optional) — Admin API bearer. Every tool call needs one, but it may come from this variable OR from the credential file written by `hiberus-eds auth token set`, so neither source is required on its own.
- `EDS_SITE` (optional) — Default site for `hiberus-eds` CLI commands that take one. Read by the CLI only — the MCP server never reads it, and a site is passed per tool call instead.

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/eds@0.1.0"
      ],
      "env": {
        "EDS_ORG": "${EDS_ORG}"
      }
    }
  }
}
```

Docs: docs/eds-onboarding.md

### @hiberus-magento/aco

Adobe Commerce Optimizer (ACO) admin and Merchandising API client — CLI and MCP server.

- Domain: aco
- Status: alpha
- Binary: `hiberus-aco-mcp`

Tools:

- `aco_search_catalog` (read-only) — Use this to search a catalog view's products by phrase and page through results, with facet buckets included. No credential is required for an unprotected view.
- `aco_get_facet_values` (read-only) — Use this to check whether an attribute is facetable for a catalog view and list its available values with counts. No credential is required for an unprotected view.
- `aco_list_catalog_views` (read-only) — Use this to discover the catalog views (viewId, locales, default price book, policies) available in this tenant. Requires an ACO admin credential.
- `aco_list_price_books` (read-only) — Use this to list price books, optionally filtered by searchTerm, and to page through more with the returned scrollId. Requires an ACO admin credential.
- `aco_list_policies` (read-only) — Use this to list every policy configured in this tenant with its actions and filters, before deciding which filter to enable or disable. Requires an ACO admin credential.
- `aco_toggle_policy_filter` — Use this to enable or disable one filter inside one named policy, addressed by the attribute it carries. There is no policy-level enable/disable in this API and no "apply to all" mode. Requires an ACO admin credential.

Environment:

- `ACO_ADMIN_BASE_URL` (required) — Base URL of this tenant's ACO admin API. Resolved on the first tool call; without it every aco_* tool fails with a configuration error, not a credential error.
- `ACO_MERCHANDISING_BASE_URL` (required) — Base URL of this tenant's ACO Merchandising API. Required on exactly the same terms as ACO_ADMIN_BASE_URL — the server checks both together.
- `ACO_TOKEN` (optional) — An admin Bearer pasted from a Studio session. One of two ways to obtain a credential — the other is minting from ACO_CLIENT_ID/ACO_CLIENT_SECRET — and it may also come from the credential file written by `hiberus-aco auth token set`.
- `ACO_CLIENT_ID` (optional) — IMS client id. With ACO_CLIENT_SECRET it mints an admin Bearer, which is the alternative to supplying ACO_TOKEN; the credential-free catalog-search tools need neither.
- `ACO_CLIENT_SECRET` (optional) — IMS client secret. Only meaningful together with ACO_CLIENT_ID; the two are checked as a pair.
- `ACO_API_KEY` (optional) — Sent as the `x-api-key` header on admin requests when set, omitted when not. Whether a tenant needs it is unconfirmed (aco design.md, Open Questions).
- `ACO_IMS_ORG_ID` (optional) — Sent as the `x-gw-ims-org-id` header on admin requests when set, omitted when not. Same unconfirmed status as ACO_API_KEY.

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-aco-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/aco@0.1.0"
      ],
      "env": {
        "ACO_ADMIN_BASE_URL": "${ACO_ADMIN_BASE_URL}",
        "ACO_MERCHANDISING_BASE_URL": "${ACO_MERCHANDISING_BASE_URL}"
      }
    }
  }
}
```

Docs: docs/aco-onboarding.md

### @hiberus-magento/magento-cloud

Magento Cloud CLI wrapper — CLI and MCP server for read-only Magento Cloud project, environment, and database operations.

- Domain: magento-cloud
- Status: alpha
- Binary: `hiberus-magento-cloud-mcp`

Tools:

- `magentocloud_auth_status` (read-only) — Use this to check whether the Magento Cloud CLI is authenticated before calling any other magentocloud_* tool. Never requires a credential itself.
- `magentocloud_list_projects` (read-only) — Use this to list every project accessible to the authenticated account — the starting point for finding a projectId.
- `magentocloud_describe_project` (read-only) — Use this to get one project's title and region by projectId, before listing its environments.
- `magentocloud_list_environments` (read-only) — Use this to list a project's environments (id, status, type, title) — most other tools need an environmentId as input.
- `magentocloud_describe_environment` (read-only) — Use this to get one environment's status and type by projectId/environmentId.
- `magentocloud_get_environment_config` (read-only) — Use this to fetch environment configuration facets on demand: variables, routes, services, serviceEndpoints (credentials never returned), appConfig, and urls.
- `magentocloud_get_activities` (read-only) — Use this to list recent deployment/activity events for a project, narrowed by limit, type, state or result — or to fetch one activity by activityId. Each event carries its machine-readable type and timings, never the human-readable description.
- `magentocloud_get_activity_log` (read-only) — Use this to read one activity's full deployment/build log by activityId, as plain text.
- `magentocloud_query_database` (read-only) — Use this for a bounded, read-only diagnostic query against an environment's database — a size check, or a single guarded SELECT/SHOW/DESCRIBE/EXPLAIN statement.

Environment:

- `MAGENTO_CLOUD_CLI_TOKEN` (optional) — An API token passed through to the magento-cloud CLI. Optional: a missing token is caught and the CLI's own stored session is used instead, so the server requires no environment variable at all.

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-magento-cloud-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/magento-cloud@0.1.0"
      ]
    }
  }
}
```

Docs: docs/magento-cloud-onboarding.md

<!-- servers:end -->

## Adding a New Server

Run `pnpm new-server <name> --domain <domain> --description "<description>"` to scaffold a new package from [`templates/server/`](./templates/server), register it in `servers.json`, and regenerate this README.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
