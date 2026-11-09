## Why

With the configuration service, a site's index (`query.yaml`) and sitemap (`sitemap.yaml`)
definitions live in the service, under `/config/{org}/sites/{site}/content/`, and override the
`helix-*.yaml` files of the code repository. A site that never received them builds no index and an
empty `sitemap.json`. The `eds` MCP could reindex a site but not set or read these definitions, so
the only way was a hand-written Admin API call per site.

## What Changes

- New plan kind `content-config.set` (`file`: `query.yaml` | `sitemap.yaml`, `content`: the whole
  YAML). It reads the current document, shows it next to the new one, warns that a reindex is needed,
  and records a `text/yaml` `PUT` (no document yet) or `POST` (replace). Same content → `no-changes`.
  Fingerprinted: a document changed between plan and apply is `stale-plan`.
- New read tool `eds_get_content_config` (`site`, `file`) → `{ site, file, exists, content }`.
- Client: `operations.contentConfig.{getContentConfig, setContentConfig}`; a 404 reads as `null`.
  Text bodies can carry `text/yaml` (`SendOptions.textType`, `PlannedRequest.textType`).

## Impact

- `packages/eds`: client, plan/apply, tools, README; `servers.json`.
- Specs: `eds-client` (Content Configuration Read and Write), `eds-mcp` (fifteen tools,
  twenty-three kinds, stale check, new requirement).
