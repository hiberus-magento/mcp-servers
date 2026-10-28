# @hiberus-magento/aem-sites

An MCP (Model Context Protocol) server, and a companion operator CLI, for the
**Adobe Experience Manager as a Cloud Service Sites author**: list and read
pages, change page properties (including robots/noindex), edit sheet pages
such as the Edge Delivery Services bulk `metadata` sheet, publish and
unpublish through Replication, and create, copy, move or delete pages.

> **AEM Sites is not EDS.** For a site whose content lives in an AEM author
> (Universal Editor / XWalk), the author is the source of truth: this package
> changes and replicates content there. The Edge Delivery Services Admin API —
> preview, live, `/metadata.json`, indexing — is
> [`@hiberus-magento/eds`](https://npmjs.com/package/@hiberus-magento/eds).
> The two servers are independent; an agent composes them.

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

## The two binaries

| Binary | What it is |
| --- | --- |
| `hiberus-aem-sites-mcp` | The **stdio MCP server**. This is what you put in an MCP client's configuration. |
| `hiberus-aem-sites` | The **operator CLI**: token storage per environment (`auth token set --env`), the auth probe (`auth status`), `pages list`, and `plan` / `apply` of the same operations the server offers. Nothing writes without `--yes`. |

```sh
npx -y --package @hiberus-magento/aem-sites hiberus-aem-sites auth status   # the CLI
npx -y --package @hiberus-magento/aem-sites hiberus-aem-sites-mcp           # the server
```

## How a change is made: plan, confirm, apply

Every write goes through two calls. `aem_plan` reads the current state and
returns exactly what would change, a `confirmationMessage` to show the user and
a one-time token — it never writes. `aem_apply` takes **only** that token (plus
the plan's `env` and `kind` as echoes) and sends exactly the stored requests,
after checking the token is known, unexpired and unused, and that the state
the user reviewed has not changed since. A model cannot apply anything other
than what the user was shown.

Operation kinds: `page.set-properties`, `page.set-robots`, `sheet.upsert-row`,
`sheet.delete-row`, `page.publish`, `page.unpublish`, `page.create`,
`page.copy`, `page.move`, `page.delete`.

**Blocking indexing.** Per page: `page.set-robots` with `["noindex",
"nofollow"]`. Site-wide: `sheet.upsert-row` on the site's `metadata` sheet
with `URL=/**` and `Robots=noindex, nofollow`, then `page.publish` of the
sheet, then preview and publish `/metadata.json` with the `eds` server.

**Blocking publication.** `AEM_PROTECTED_PATHS` makes `page.publish` on those
paths a rejected plan (unless `AEM_ALLOW_PROTECTED_PUBLISH=1`);
`page.unpublish` takes down what is already out. This restricts what goes
through this server, not what an editor can do in the Sites console.

<!-- package:start -->

## Tools

- `aem_list_environments` (read-only) — Use this first, or when you need to know which AEM author environments are configured, which are protected, the write roots, and whether each has a token stored (never the token). **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_check_auth` (read-only) — Use this when a call failed with an auth error, or before a batch, to check that an environment's token is accepted by its author. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_list_pages` (read-only) — Use this to find the pages under a content root, paginated. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_get_page` (read-only) — Use this to read one page's properties and its replication state on preview and publish. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_get_replication_status` (read-only) — Use this to check whether up to 100 pages are published on preview and publish. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_get_sheet` (read-only) — Use this to read a sheet page's columns and rows, e.g. the EDS bulk metadata sheet. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_list_templates` (read-only) — Use this before planning page.create, to find template paths under a /conf root. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_get_page_tree` (read-only) — Use this when you need a page's component tree, depth 1–4. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_plan` (read-only) — Use this whenever you want to change anything on an AEM author; it returns exactly what would change and a one-time token, and never writes. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.
- `aem_apply` — Use this only after the user explicitly confirms a plan from aem_plan; it sends exactly the planned requests and nothing else. **Not verified against a live service** — Not yet run against a live AEM author; the endpoints it uses were exercised by the project's field CLI, not by this package.

## Environment

- `AEM_AUTHORS` (required) — Comma-separated <env>=<author origin> pairs, e.g. stage=https://author-p<program>-e<environment>.adobeaemcloud.com. Env names are lowercase letters and digits. The server resolves it on the first tool call and refuses the call without it; tools/list still works. A malformed value stops the server at startup. Each environment's bearer token comes from AEM_TOKEN_<ENV> (e.g. AEM_TOKEN_STAGE) or from the 0600 file written by `hiberus-aem-sites auth token set --env <env>`, re-read on every call.
- `AEM_WRITE_ROOTS` (optional) — Comma-separated page paths under /content/ (never /content/dam) that plans may write. Unset: every plan is rejected; reads still work.
- `AEM_EXTRA_PROPERTIES` (optional) — Exact page-property names, beyond the built-in allowlist, that page.set-properties may write and aem_get_page may read. Sling operators and structural properties are refused.
- `AEM_PROTECTED_ENVS` (optional) — Comma-separated environment names. A plan against one makes aem_apply require the user to type the env name.
- `AEM_PROTECTED_PATHS` (optional) — Comma-separated path patterns (`*` = one whole segment; a match protects everything below). Publishing them is blocked; other plans require the user to type the pattern.
- `AEM_ALLOW_PROTECTED_PUBLISH` (optional) — "1" allows page.publish on protected paths, still behind the typed confirmation. Default: blocked.

## Configure in an MCP client

Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-aem-sites-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/aem-sites@0.0.0",
        "hiberus-aem-sites-mcp"
      ],
      "env": {
        "AEM_AUTHORS": "${AEM_AUTHORS}"
      }
    }
  }
}
```

<!-- package:end -->

A configuration that is set but malformed stops the server at startup; an
unset `AEM_AUTHORS` does not — `tools/list` works and each call names it.

## Credentials

One bearer token per environment: the **local development token** from the
Developer Console of that AEM environment (it lasts 24 hours). It is resolved
on every call, so a renewed token is picked up without restarting the MCP
client:

1. `AEM_TOKEN_<ENV>`, if set and non-empty.
2. `$XDG_CONFIG_HOME/hiberus/aem-sites-<env>.json` (default
   `$HOME/.config/hiberus/…`), written at mode `0600` by
   `hiberus-aem-sites auth token set --env <env>`; any other mode is refused.

```sh
pbpaste | hiberus-aem-sites auth token set --env stage
```

The CLI accepts the raw token, a `Bearer `-prefixed one, or the JSON the
Developer Console downloads. It reads **stdin only**. The token is sent only to
the configured author origin, never across a redirect: an expired token shows
up as a redirect to the login page, which is reported as an auth error naming
the command above.

## What this server deliberately cannot do

There is no tool that sends a request to a caller-supplied URL or with
caller-supplied form field names. Writes are limited to `AEM_WRITE_ROOTS`, page
properties to a closed allowlist, and Sling POST operators (`@MoveFrom`,
`@CopyFrom`, `:operation`, …) are refused in any name. Assets, users, ACLs,
OSGi, `/apps`, `/libs`, `/conf` and Package Manager are out of scope.

## Verification status

Every tool above carries **Not verified against a live service**: this package
has not yet been run against a real AEM author. The endpoints it uses were
exercised against a real author by the project's field CLI; this code is
covered by unit tests and by the shared conformance suite.

## Documentation

- [AEM Sites onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/aem-sites-onboarding.md)
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md)
- [Repository](https://github.com/hiberus-magento/mcp-servers)

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
