# @hiberus-magento/eds

An MCP (Model Context Protocol) server, and a companion operator CLI, for the
**Adobe Edge Delivery Services Admin API** — the API documented at
<https://www.aem.live/docs/admin.html>. It reads a site's state — status,
configuration, versions, `robots.txt`, code, jobs, the audit log, snapshots —
and changes it through one reviewed path: **`eds_plan` shows exactly what would
happen, the user confirms, and `eds_apply` does exactly that and nothing else.**

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
| `hiberus-eds` | The **operator CLI**, for a human at a terminal. It handles credential storage (`auth token set`), key minting (`auth mint`), key listing (`auth keys list`) and reachability checks (`auth status`). Storing and minting keys are not, and will never be, MCP tools. |

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
- `eds_get_site_config` (read-only) — Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance.
- `eds_get_audit_log` (read-only) — Use this to review recent changes to a site. Returns one page of entries plus a nextToken cursor.
- `eds_get_snapshots` (read-only) — Use this to list a site's snapshots, or to inspect one by id.
- `eds_get_job_status` (read-only) — Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned by eds_apply when wait was not requested.
- `eds_list_sites` (read-only) — Use this to find which sites exist in the configured org. **Not verified against a live service** — Built from the Admin API contract and covered by unit tests, but never run against a live Edge Delivery Services site.
- `eds_get_config_versions` (read-only) — Use this to see a site's configuration history before planning a version.restore. **Not verified against a live service** — Built from the Admin API contract and covered by unit tests, but never run against a live Edge Delivery Services site.
- `eds_get_robots` (read-only) — Use this to read a site's robots.txt as text. **Not verified against a live service** — Built from the Admin API contract and covered by unit tests, but never run against a live Edge Delivery Services site.
- `eds_get_code_status` (read-only) — Use this to check one code file's status; the repository is resolved from the site's configuration. **Not verified against a live service** — Built from the Admin API contract and covered by unit tests, but never run against a live Edge Delivery Services site.
- `eds_list_jobs` (read-only) — Use this to list a site's jobs for one topic. **Not verified against a live service** — Built from the Admin API contract and covered by unit tests, but never run against a live Edge Delivery Services site.
- `eds_list_api_keys` (read-only) — Use this to see the org's Admin API keys — metadata only. Creating and deleting keys is CLI-only.
- `eds_plan` (read-only) — Use this for any change to an EDS site. Changes nothing: returns exactly what would happen, a confirmation message for the user and a one-time token.
- `eds_apply` — Use this only after the user explicitly confirms a plan from eds_plan. Takes only the plan's token and issues exactly the planned requests. Destructive. **Not verified against a live service** — Of its 22 operation kinds, only snapshot.add and snapshot.delete (as the former eds_manage_snapshot) have run against a live Edge Delivery Services site. Every other kind is built from the Admin API contract and covered by unit tests only.

## Environment

- `EDS_ORG` (required) — The Edge Delivery Services organisation every eds_* tool addresses. The server resolves it on the first tool call and refuses the call without it; tools/list still works.
- `EDS_TOKEN` (optional) — Admin API bearer. Every tool call needs one, but it may come from this variable OR from the credential file written by `hiberus-eds auth token set`, so neither source is required on its own.
- `EDS_SITE` (optional) — Default site for `hiberus-eds` CLI commands that take one. Read by the CLI only — the MCP server never reads it, and a site is passed per tool call instead.
- `EDS_PROTECTED_SITES` (optional) — Comma-separated site-name patterns (`*` is the only wildcard; anchored, case-sensitive). A plan for a matching site makes eds_apply require the user to repeat the site name. Read once at server startup.

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

**Roles.** Minting requires a key that already carries `config_admin`. Plain
`config` is a different, narrower role and is not enough. The same holds for
`eds_get_site_config`. Measured against a live organisation, a key carrying
`config, author, publish` is answered 403 on the site-config paths but succeeds
on the status and audit-log endpoints.

**Inferred from the path, not measured:** every other read or write under
`/config/{org}/` needs `config_admin` too. That covers:
- `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots` and
  `eds_list_api_keys`;
- `eds_get_code_status` and `code.*` plans, which read the site's `code`
  block;
- the `config.patch`, `site.*`, `version.restore` and `robots.set` operations.

`preview.*` and `live.*` plans also read the site document, to check for an AEM
content source. With a day-to-day key they skip that check and say so in a
warning, rather than failing.

If site configuration is the only thing you need `config_admin` for, consider
minting a separate key for it rather than widening the one in daily use.

`hiberus-eds auth status` reports a per-probe verdict — `reachable`,
`key rejected (401)`, `key lacks the required role (403)`,
`org or site not found (404)` — which is the quickest way to tell a role
problem from a credential problem. It never prints the token, only an
8-hex-character fingerprint.

## Changing a site: plan, confirm, apply

Every write goes through two tools. No other tool writes.

1. **`eds_plan`** takes `{ site, ref?, operation }` and changes nothing. It
   reads what the operation depends on and returns:
   - a one-line `summary` and the exact requests that will be sent;
   - for configuration changes, every changed key with its value before and
     after;
   - `warnings`;
   - a `confirmationMessage` assembled by the server, so every model relays the
     same text;
   - an `instruction` telling the model to show that message and to wait for
     an explicit yes;
   - a one-time `token`.
2. **The user confirms** in the conversation.
3. **`eds_apply`** takes only `{ token, confirmSite?, wait? }`. It cannot
   restate the operation, so it cannot alter it, and it sends exactly the
   requests the plan recorded.

A token is 32 random bytes and expires after ten minutes. It is spent the
moment `eds_apply` starts, whether the apply then succeeds, fails or is
rejected, so a retry never repeats a write: plan again instead. Tokens live in
the server's memory only, so restarting the server invalidates every one of
them.

**Stale plans.** For `config.patch`, `site.delete`, `version.restore` and
`robots.set`, `eds_apply` re-reads what the user reviewed and writes nothing if
it changed in the meantime (`stale-plan`). For `site.create`, it rejects the
apply if the site has been created since the plan.

**Configuration changes.** `config.patch` is an
RFC 7386 JSON Merge Patch:
- objects merge;
- `null` removes a key;
- arrays and scalars are replaced whole.

The plan sends the whole merged document, so what is applied is what was shown.
A patch that changes nothing returns `no-changes` and no token. Applied
configuration changes report `previousVersionId`, the newest version before the
change, to use with `version.restore`.

### Operation kinds

| Area | Kinds |
| --- | --- |
| Site configuration | `config.patch`, `site.create`, `site.delete`, `version.restore`, `robots.set` |
| Content | `preview.update`, `preview.delete`, `live.publish`, `live.unpublish` |
| Index, cache, sitemap | `index.update`, `index.delete`, `index.full-site` (requires `confirmFullReindex: true`), `cache.purge`, `sitemap.rebuild` |
| Code | `code.sync`, `code.delete`. The repository is read from the site's own `code` block, never supplied. |
| Jobs and snapshots | `job.stop`, `snapshot.add`, `snapshot.remove`, `snapshot.publish`, `snapshot.review`, `snapshot.delete` |

`paths` takes 1 to 100 entries and is never read as "everything". `ref`
defaults to `main` and is accepted only by the kinds that are addressed by
branch.

### Protected sites

`EDS_PROTECTED_SITES` is a comma-separated list of site-name patterns. `*` is the
only wildcard; matching is anchored and case-sensitive, and every other
character is literal. For example:

```sh
EDS_PROTECTED_SITES="acme-demo-site-us,*-prod"
```

A plan for a matching site warns, and `eds_apply` refuses it until `confirmSite`
repeats the site name exactly. That refusal does **not** spend the token, so the
user can simply answer again.

### What this protects against, and what it does not

The token guarantees three things: nothing is written without a plan, exactly
the planned requests are sent, and a reused, expired or stale plan is refused. It
does **not** prove that a human said yes. That relies on the model following the
plan's instruction, and on your MCP client asking before `eds_apply`. Claude
Code asks on every call because `eds_apply` is marked
`anthropic/requiresUserInteraction`. Other clients need one setting each; see
[EDS onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/eds-onboarding.md#confirming-eds_apply-in-your-client).

### What stays off the MCP surface

**API key writes.** `auth mint` returns the key value exactly once, and over MCP
that value would land in the model's context and transcript, so it is
CLI-only. Deleting a key is an org-level operation that does not fit a
site-scoped plan, so it is not an MCP operation either, and this release's CLI
does not implement it: delete keys in Adobe's admin UI.
`eds_list_api_keys` shows the org's keys as metadata, never key material.

**Project-specific orchestration**, such as generating site documents from a
site model or applying one change to many sites, belongs in the consuming
project. That project can compose `eds_plan` operations.

### Migrating from 0.1

| 0.1 tool | 0.2 equivalent |
| --- | --- |
| `eds_set_live_state` with `state: "published"` | `eds_plan` with `{ kind: "live.publish", paths }`, then `eds_apply` |
| `eds_set_live_state` with `state: "unpublished"` | `eds_plan` with `{ kind: "live.unpublish", paths }`, then `eds_apply` |
| `eds_set_live_state` with `wait: true` | `eds_apply` with `wait: true` |
| `eds_reindex` with `scope: "paths"` | `eds_plan` with `{ kind: "index.update", paths }`, then `eds_apply` |
| `eds_reindex` with `scope: "full-site"` | `eds_plan` with `{ kind: "index.full-site", confirmFullReindex: true }`, then `eds_apply` |
| `eds_manage_snapshot` with `verb: "add"` (and so on) | `eds_plan` with `{ kind: "snapshot.add", id, paths? }` (and so on), then `eds_apply` |

In 0.1, `eds_set_live_state` with `unpublished` on several paths sent the bulk
job without `delete: true`. `live.unpublish` sends it.

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
