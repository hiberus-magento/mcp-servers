# @hiberus-magento/magento-cloud

An MCP (Model Context Protocol) server, and a companion operator CLI, for
**Adobe Commerce on Cloud** (Magento Cloud): projects, environments,
environment configuration, deployment activities and their logs, and a
deliberately narrow read-only database diagnostic.

Every tool on this surface is read-only.

> This package is a **wrapper around the real, third-party
> [Magento Cloud CLI](https://github.com/platformsh/legacy-cli)**. That CLI is
> a prerequisite: it is never installed, bundled or vendored here. Install it
> yourself and confirm `magento-cloud --version` succeeds before configuring
> anything below.

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

## The two binaries

| Binary | What it is |
| --- | --- |
| `hiberus-magento-cloud-mcp` | The **stdio MCP server**. This is what you put in an MCP client's configuration. It speaks JSON-RPC on stdout and nothing else. |
| `hiberus-magento-cloud` | The **operator CLI**, for a human at a terminal: credential storage (`auth token set`), `auth status`, and the CLI-only escape hatches that are deliberately absent from the MCP surface. |

Because the package declares two binaries, `npx` has to be told which one to
run — the bare `npx -y @hiberus-magento/magento-cloud` form cannot guess, and
exits with `could not determine executable to run`:

```sh
npx -y --package @hiberus-magento/magento-cloud hiberus-magento-cloud auth status
npx -y --package @hiberus-magento/magento-cloud hiberus-magento-cloud-mcp
```

<!-- package:start -->

## Tools

- `magentocloud_auth_status` (read-only) — Use this to check whether the Magento Cloud CLI is authenticated before calling any other magentocloud_* tool. Never requires a credential itself.
- `magentocloud_list_projects` (read-only) — Use this to list every project accessible to the authenticated account — the starting point for finding a projectId.
- `magentocloud_describe_project` (read-only) — Use this to get one project's title and region by projectId, before listing its environments.
- `magentocloud_list_environments` (read-only) — Use this to list a project's environments (id, status, type, title) — most other tools need an environmentId as input.
- `magentocloud_describe_environment` (read-only) — Use this to get one environment's status and type by projectId/environmentId.
- `magentocloud_get_environment_config` (read-only) — Use this to fetch environment configuration facets on demand: variables, routes, services, serviceEndpoints (credentials never returned), appConfig, and urls.
- `magentocloud_get_activities` (read-only) — Use this to list recent deployment/activity events for a project, narrowed by limit, type, state or result — or to fetch one activity by activityId. Each event carries its machine-readable type and timings, never the human-readable description.
- `magentocloud_get_activity_log` (read-only) — Use this to read one activity's full deployment/build log by activityId, as plain text.
- `magentocloud_query_database` (read-only) — Use this for a bounded, read-only diagnostic query against an environment's database — a size check, or a single guarded SELECT/SHOW/DESCRIBE/EXPLAIN statement.

## Environment

- `MAGENTO_CLOUD_CLI_TOKEN` (optional) — An API token passed through to the magento-cloud CLI. Optional: a missing token is caught and the CLI's own stored session is used instead, so the server requires no environment variable at all.

## Configure in an MCP client

Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-magento-cloud-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/magento-cloud@0.1.1",
        "hiberus-magento-cloud-mcp"
      ]
    }
  }
}
```

<!-- package:end -->

## Credentials

**This server needs nothing in its MCP client configuration.** It defers to the
`magento-cloud` CLI's own stored session, so running `magento-cloud login` once
on the machine is enough — that is the first remedy this package's own
not-authenticated error names. `MAGENTO_CLOUD_CLI_TOKEN` is genuinely optional:
when it is absent, the missing-token case is caught and the upstream CLI's own
session is used instead.

If you do want to supply a token — for CI, or for an account without an
interactive session — it may come from either:

1. `MAGENTO_CLOUD_CLI_TOKEN`, which always wins when set; or
2. `$XDG_CONFIG_HOME/hiberus/magento-cloud.json` (default
   `$HOME/.config/hiberus/magento-cloud.json`), written by:

   ```sh
   echo "$TOKEN" | hiberus-magento-cloud auth token set
   ```

   The token is read from **stdin only** — there is no `--token` flag, and
   `auth token set --token abc123` is rejected before anything is persisted.
   The file is created at mode `0600`, and a file whose mode is anything else
   is refused outright.

The token comes from your Magento Cloud / Adobe Commerce on Cloud account
settings; there is no API call this package could make to bootstrap one.

`magentocloud_auth_status` is the one tool that tolerates an absent credential
entirely — reporting `authenticated: false` is its whole job. Every other tool
re-reads the credential per call rather than caching it at startup, so fixing a
credential while the server is running takes effect on the very next call, with
no restart.

## The three failure shapes

Every tool call classifies a failure into one of three named shapes before
returning anything generic, and each names its own remedy:

1. **CLI not installed** — detected *before any process is spawned*, by an
   explicit `PATH` walk. In an MCP client this most often means the client
   process's own `PATH` does not include where the CLI was installed; check the
   client's environment, not just your interactive shell's.
2. **Not authenticated** — detected from the real CLI's own non-interactive
   stderr. The remedy names the easier exit first (`magento-cloud login`, to
   authenticate the upstream CLI itself) and then the headless one
   (`MAGENTO_CLOUD_CLI_TOKEN`, or `hiberus-magento-cloud auth token set`).
3. **Unsupported CLI version** — **warn-only, never blocking.** The observed
   baseline is `Magento Cloud CLI 1.47.0`. An older or newer CLI never fails a
   call on its own.

## What this server deliberately does not do

`ssh`, every `tunnel:*` form, `db:dump`, and the CLI's own generic REST
passthroughs (`api:curl`, `project:curl`, `organization:curl`,
`environment:curl`) have no MCP tool, and will not get one. `auth token set`
and the raw, unstripped `environment:relationships` output — which may include
live service credentials — are CLI-only for the same reason: an interactive
human at a terminal can be trusted to view a credential; an autonomous MCP
client cannot be assumed to be one.

`magentocloud_get_environment_config` returns service endpoints as
`host`/`port`/`scheme`/`service` only — credential fields are never returned.

`magentocloud_query_database` is the only tool that reaches a database, and it
is intentionally narrow: a `{ kind: "size" }` usage check, or one guarded
`SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN`. Every write verb, a bare `*` projection
(except `COUNT(*)`), and every file-exfiltration form (`INTO OUTFILE`,
`INTO DUMPFILE`, `LOAD_FILE(`) is rejected before any process is spawned. A
`SELECT` with no `LIMIT` gets `LIMIT 200` injected; `rowsReturned === rowCap`
in the result is your signal that more rows exist.

## Documentation

- [Magento Cloud onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/magento-cloud-onboarding.md) — the day-one bootstrap sequence, the three failure modes in full, and the manual acceptance checklist.
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md) — where MCP client configuration lives, and which file must never hold a secret.
- [Repository](https://github.com/hiberus-magento/mcp-servers) — source, issues, and the other servers in this family.

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
