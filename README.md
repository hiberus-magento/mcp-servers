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
- `eds_set_live_state` — Use this to publish or unpublish one or more paths on a site. Destructive: it changes what is publicly live.
- `eds_get_site_config` (read-only) — Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance.
- `eds_reindex` — Use this to re-run indexing for specific paths, or — only with explicit double confirmation — the entire site.
- `eds_get_audit_log` (read-only) — Use this to review recent changes to a site. Returns one page of entries plus a nextToken cursor.
- `eds_get_snapshots` (read-only) — Use this to list a site's snapshots, or to inspect one by id.
- `eds_manage_snapshot` — Use this to add paths to a snapshot, remove them, publish it, submit a review decision, or delete it.
- `eds_get_job_status` (read-only) — Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned earlier by eds_set_live_state or eds_reindex.

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/eds@0.0.0"
      ],
      "env": {
        "EDS_ORG": "${EDS_ORG}",
        "EDS_TOKEN": "${EDS_TOKEN}"
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

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-aco-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/aco@0.0.0"
      ],
      "env": {
        "ACO_CLIENT_ID": "${ACO_CLIENT_ID}",
        "ACO_CLIENT_SECRET": "${ACO_CLIENT_SECRET}"
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

Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-magento-cloud-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@hiberus-magento/magento-cloud@0.0.0"
      ],
      "env": {
        "MAGENTO_CLOUD_CLI_TOKEN": "${MAGENTO_CLOUD_CLI_TOKEN}"
      }
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
