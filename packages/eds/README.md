# @hiberus-magento/eds

An MCP (Model Context Protocol) server, and a companion operator CLI, for the
**Adobe Edge Delivery Services Admin API** — the API documented at
<https://www.aem.live/docs/admin.html>. It covers a site's publishing surface:
per-path and bulk status, publish and unpublish, the full effective site
configuration, re-indexing, the audit log, snapshots, and job polling.

> **EDS is not ACS, and not ACO.** Three adjacent Adobe acronyms that are
> routinely confused, and that Adobe has renamed before:
>
> - **EDS** — Edge Delivery Services: the publishing platform. **This package.**
> - **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS.
> - **ACO** — Adobe Commerce Optimizer, served by
>   [`@hiberus-magento/aco`](https://npmjs.com/package/@hiberus-magento/aco).

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

## The two binaries

| Binary | What it is |
| --- | --- |
| `hiberus-eds-mcp` | The **stdio MCP server**. This is what you put in an MCP client's configuration. It speaks JSON-RPC on stdout and nothing else. |
| `hiberus-eds` | The **operator CLI**, for a human at a terminal. It handles credential storage (`auth token set`), key minting (`auth mint`), key listing (`auth keys list`) and reachability checks (`auth status`) — none of which are, or will ever be, MCP tools. |

Because the package declares two binaries, `npx` has to be told which one to
run — the bare `npx -y @hiberus-magento/eds` form cannot guess, and exits with
`could not determine executable to run`:

```sh
npx -y --package @hiberus-magento/eds hiberus-eds auth status   # the CLI
npx -y --package @hiberus-magento/eds hiberus-eds-mcp           # the server
```

<!-- package:start -->

## Tools

- `eds_get_status` (read-only) — Use this when you need one path's current status across edit/preview/live/code/index on a single site — the smallest, cheapest status call.
- `eds_get_status_bulk` (read-only) — Use this when you need status for several paths on a site at once instead of calling eds_get_status in a loop.
- `eds_set_live_state` — Use this to publish or unpublish one or more paths on a site. Destructive: it changes what is publicly live. **Not verified against a live service** — Never run against a live Edge Delivery Services site. The Admin API publishes content that already exists rather than creating it; the site this package was developed against keeps its content in AEM as a Cloud Service, and the package ships no preview operation, so there was no page that could be published safely. Its request shape is covered by unit tests and by the conformance suite.
- `eds_get_site_config` (read-only) — Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance.
- `eds_reindex` — Use this to re-run indexing for specific paths, or — only with explicit double confirmation — the entire site. **Not verified against a live service** — Never run against a live Edge Delivery Services site, at either scope.
- `eds_get_audit_log` (read-only) — Use this to review recent changes to a site. Returns one page of entries plus a nextToken cursor.
- `eds_get_snapshots` (read-only) — Use this to list a site's snapshots, or to inspect one by id.
- `eds_manage_snapshot` — Use this to add paths to a snapshot, remove them, publish it, submit a review decision, or delete it. **Not verified against a live service** — Partly run against a live Edge Delivery Services site: the add and delete verbs were exercised as a reversible pair. The publish, review and remove verbs were not.
- `eds_get_job_status` (read-only) — Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned earlier by eds_set_live_state or eds_reindex.

## Environment

- `EDS_ORG` (required) — The Edge Delivery Services organisation every eds_* tool addresses. The server resolves it on the first tool call and refuses the call without it; tools/list still works.
- `EDS_TOKEN` (optional) — Admin API bearer. Every tool call needs one, but it may come from this variable OR from the credential file written by `hiberus-eds auth token set`, so neither source is required on its own.
- `EDS_SITE` (optional) — Default site for `hiberus-eds` CLI commands that take one. Read by the CLI only — the MCP server never reads it, and a site is passed per tool call instead.

## Configure in an MCP client

Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/eds@0.1.1",
        "hiberus-eds-mcp"
      ],
      "env": {
        "EDS_ORG": "${EDS_ORG}"
      }
    }
  }
}
```

<!-- package:end -->

## Credentials

Every tool call needs an Admin API bearer, and `EDS_ORG` must name the
organisation. `tools/list` works without either; `tools/call` fails
immediately and actionably, naming the remedy — it never hangs and never
prompts.

The bearer is resolved in this order, with no third branch:

1. `EDS_TOKEN`, if set and non-empty.
2. `$XDG_CONFIG_HOME/hiberus/eds.json` (default
   `$HOME/.config/hiberus/eds.json`), the file written by
   `hiberus-eds auth token set`. It is created at file mode `0600`, and a file
   whose mode is anything else is **refused outright**, not warned about.
3. Otherwise the call fails with a message naming both of the above.

Storing the token in that file means it need not appear in an MCP client's
configuration file, nor in any shell variable:

```sh
echo "$KEY" | hiberus-eds auth token set
```

The token is read from **stdin only**. There is no `--token` flag anywhere in
this CLI, and there never will be — a flag value lands in shell history and in
other users' `ps` output; a pipe does not.

**Where the first key comes from.** The very first Admin API key for an
organisation can only be created in Adobe's own admin/Sidekick UI — there is no
API call this package could make to bootstrap itself. Once you have one,
`hiberus-eds auth mint --roles publish,author` mints narrower day-to-day keys
from it. Keys belong to the **organisation**, not to a site:
`POST /config/{org}/apiKeys.json` is where they live, and the site-level path
answers 404.

**Roles.** Minting requires a key that already carries `config_admin`; plain
`config` is a different, narrower role and is not enough. `eds_get_site_config`
also requires `config_admin` — measured against a live organisation, a key
carrying `config, author, publish` is answered 403 on the site-config paths and
succeeds on the status and audit-log endpoints. Every other tool here is
satisfied by the day-to-day roles. If site configuration is the only thing you
need `config_admin` for, consider minting a separate key for it rather than
widening the one in daily use.

`hiberus-eds auth status` reports a per-probe verdict — `reachable`,
`key rejected (401)`, `key lacks the required role (403)`,
`org or site not found (404)` — which is the quickest way to tell a role
problem from a credential problem. It never prints the token, only an
8-hex-character fingerprint.

## What this server deliberately does not do

`site apply`, `site delete`, `site source set`, `key create`, `key delete`,
`auth mint`, `code show`, `code sync`, `code delete`, `version restore`,
`cache purge`, `robots show` and `sitemap rebuild` have no MCP tool, and will
not get one. Minting and rotating credentials, restoring a prior version, and
repository-adjacent code operations are high blast radius or easy for an agent
to aim at the wrong site; they stay with a human at the terminal. `auth mint`
is implemented as a CLI command; the rest have no implementation in this
release at all.

## Verification status

Tools above carrying **Not verified against a live service** have not been run
against a real Edge Delivery Services organisation, in whole or in part. That
is a statement about what was exercised, not a report of a defect: each is
covered by unit tests and by this repository's shared conformance suite, and
nothing marked there is known to be broken. The absence of the marker records
no claim either way — it is not a verification badge.

## Documentation

- [EDS onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/eds-onboarding.md) — the day-one bootstrap sequence, step by step.
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md) — where MCP client configuration lives, and which file must never hold a secret.
- [Repository](https://github.com/hiberus-magento/mcp-servers) — source, issues, and the other servers in this family.

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
