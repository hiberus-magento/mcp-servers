# @hiberus-magento/aco

An MCP (Model Context Protocol) server, and a companion operator CLI, for
**Adobe Commerce Optimizer (ACO)** — both of its APIs: the Merchandising
surface (catalog search and facets) and the admin GraphQL surface (catalog
views, price books and policies).

> **ACO is not EDS, and not ACS.** Three adjacent Adobe acronyms that are
> routinely confused, and that Adobe has renamed before:
>
> - **ACO** — Adobe Commerce Optimizer. **This package.**
> - **EDS** — Edge Delivery Services, the publishing platform, served by
>   [`@hiberus-magento/eds`](https://npmjs.com/package/@hiberus-magento/eds).
> - **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS.

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

## The two binaries

| Binary | What it is |
| --- | --- |
| `hiberus-aco-mcp` | The **stdio MCP server**. This is what you put in an MCP client's configuration. It speaks JSON-RPC on stdout and nothing else. |
| `hiberus-aco` | The **operator CLI**, for a human at a terminal. It handles credential storage (`auth token set`), minting (`auth mint`), status (`auth status`), and the destructive operations that are deliberately absent from the MCP surface. |

Because the package declares two binaries, `npx` has to be told which one to
run — the bare `npx -y @hiberus-magento/aco` form cannot guess, and exits with
`could not determine executable to run`:

```sh
npx -y --package @hiberus-magento/aco hiberus-aco auth status   # the CLI
npx -y --package @hiberus-magento/aco hiberus-aco-mcp           # the server
```

## Two tiers, two very different setup costs

- **Tier A** — `aco_search_catalog`, `aco_get_facet_values`. These go to the
  Merchandising API and need **no credential at all** against an unprotected
  catalog view.
- **Tier B** — everything else. These go to the admin GraphQL API and need an
  admin Bearer.

Both tiers still need the two base URLs below.

<!-- package:start -->

## Tools

- `aco_search_catalog` (read-only) — Use this to search a catalog view's products by phrase and page through results, with facet buckets included. No credential is required for an unprotected view.
- `aco_get_facet_values` (read-only) — Use this to check whether an attribute is facetable for a catalog view and list its available values with counts. No credential is required for an unprotected view.
- `aco_list_catalog_views` (read-only) — Use this to discover the catalog views (viewId, locales, default price book, policies) available in this tenant. Requires an ACO admin credential.
- `aco_list_price_books` (read-only) — Use this to list price books, optionally filtered by searchTerm, and to page through more with the returned scrollId. Requires an ACO admin credential.
- `aco_list_policies` (read-only) — Use this to list every policy configured in this tenant with its actions and filters, before deciding which filter to enable or disable. Requires an ACO admin credential.
- `aco_toggle_policy_filter` — Use this to enable or disable one filter inside one named policy, addressed by the attribute it carries. There is no policy-level enable/disable in this API and no "apply to all" mode. Requires an ACO admin credential.

## Environment

- `ACO_ADMIN_BASE_URL` (required) — Base URL of this tenant's ACO admin API. Resolved on the first tool call; without it every aco_* tool fails with a configuration error, not a credential error.
- `ACO_MERCHANDISING_BASE_URL` (required) — Base URL of this tenant's ACO Merchandising API. Required on exactly the same terms as ACO_ADMIN_BASE_URL — the server checks both together.
- `ACO_TOKEN` (optional) — An admin Bearer pasted from a Studio session. One of two ways to obtain a credential — the other is minting from ACO_CLIENT_ID/ACO_CLIENT_SECRET — and it may also come from the credential file written by `hiberus-aco auth token set`.
- `ACO_CLIENT_ID` (optional) — IMS client id. With ACO_CLIENT_SECRET it mints an admin Bearer, which is the alternative to supplying ACO_TOKEN; the credential-free catalog-search tools need neither.
- `ACO_CLIENT_SECRET` (optional) — IMS client secret. Only meaningful together with ACO_CLIENT_ID; the two are checked as a pair.
- `ACO_API_KEY` (optional) — Sent as the `x-api-key` header on admin requests when set, omitted when not. Whether a tenant needs it is unconfirmed (aco design.md, Open Questions).
- `ACO_IMS_ORG_ID` (optional) — Sent as the `x-gw-ims-org-id` header on admin requests when set, omitted when not. Same unconfirmed status as ACO_API_KEY.

## Configure in an MCP client

Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-aco-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/aco@0.1.1",
        "hiberus-aco-mcp"
      ],
      "env": {
        "ACO_ADMIN_BASE_URL": "${ACO_ADMIN_BASE_URL}",
        "ACO_MERCHANDISING_BASE_URL": "${ACO_MERCHANDISING_BASE_URL}"
      }
    }
  }
}
```

<!-- package:end -->

## Credentials

`hiberus-aco-mcp` starts with no configuration and answers `tools/list`
immediately. The first `tools/call` resolves `ACO_ADMIN_BASE_URL` and
`ACO_MERCHANDISING_BASE_URL` together; if either is missing or empty, every
`aco_*` tool fails with a **configuration** error naming both, not a credential
error. Set them and restart the server.

For Tier B, an admin Bearer is obtained one of two ways.

**Minting from IMS client credentials (the normal path).** Set `ACO_CLIENT_ID`
and `ACO_CLIENT_SECRET`; the server mints on first use and re-mints on expiry,
so Tier B stays available for the life of the process with no human
round-trip. Two concurrent calls that both find an expired token trigger
exactly one mint.

Read them into the environment without touching shell history or `ps`:

```sh
read -rs ACO_CLIENT_ID    && export ACO_CLIENT_ID
read -rs ACO_CLIENT_SECRET && export ACO_CLIENT_SECRET
```

There is no `--client-id`/`--client-secret` flag, and no `--token` flag, for
exactly that reason.

> **The step that trips everyone:** the OAuth Server-to-Server credential must
> be created inside a Developer Console project that has the **Adobe Commerce
> Optimizer Admin** API added to it. A credential from a project without that
> API fails `client_credentials` with `unauthorized_client` even for the bare
> `openid,AdobeID` scope — which reads exactly like a broken grant and is not
> one. Adding the API to the existing project is sufficient.
>
> And getting an `access_token` back proves nothing on its own: IMS can return
> a well-formed `200` whose token carries **fewer** scopes than requested, with
> no error to catch. Decode the JWT payload and confirm `commerce.aco.admin` is
> in `scope` before trusting the credential. The ACO onboarding doc has the
> exact commands.

**A pasted Studio Bearer (for an operator without Console access).** Set
`ACO_TOKEN`, or store it out of config entirely:

```sh
echo "$BEARER" | hiberus-aco auth token set
```

The value is read from **stdin only** and written to
`$XDG_CONFIG_HOME/hiberus/aco.json` (default `$HOME/.config/hiberus/aco.json`)
at file mode `0600`; a file whose mode is anything else is refused outright.

A stored or env Bearer **always wins** over client credentials once present —
deliberately, because an operator only pastes one on purpose. To go back to
minting, remove the stored file and unset `ACO_TOKEN`. A pasted Bearer expires;
this package checks its decoded `created_at`/`expires_in` and fails the call
*before* sending a request once it has elapsed. The credential file is re-read
on every call, so pasting a fresh value restores Tier B on the very next tool
call, with no restart.

## What this server deliberately does not do

`provision`, `policy disable --all`, `policy delete`, `policy init`,
`view delete`, `view prune`, `api query`, and every `auth`/`profile`
subcommand have no MCP tool, and will not get one. Bulk provisioning,
destructive deletes and interactive credential management either have a large
blast radius or require a human confirming a destination; they stay with
`hiberus-aco` at the terminal.

`aco_toggle_policy_filter` is the one mutating tool on this surface. It
operates on exactly one filter inside one explicitly named policy. There is no
"apply to all" mode here, and no policy-level enable/disable exists in this API
to offer one. Because the upstream `updatePolicy` replaces the whole policy
rather than patching it, the tool reads the policy first and writes every other
field back unchanged — and if the read did not return something the write must
carry, it writes nothing and says so.

## Documentation

- [ACO onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/aco-onboarding.md) — the day-one bootstrap sequence, including the two traps above in full.
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md) — where MCP client configuration lives, and which file must never hold a secret.
- [Repository](https://github.com/hiberus-magento/mcp-servers) — source, issues, and the other servers in this family.

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
