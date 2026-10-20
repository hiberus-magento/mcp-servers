# EDS onboarding

The day-one bootstrap sequence for `@hiberus-magento/eds` — the
`hiberus-eds` CLI and the `hiberus-eds-mcp` server. Every example below uses
the synthetic identifiers from
`packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`
(`acme-demo-org`, `acme-demo-site-eu`) — substitute your own organization
and site.

## Step 1 — get a first admin-scoped key (outside this package)

The very first Edge Delivery Services Admin API key for an organization can
only be created in Adobe's own admin/Sidekick UI. There is no API call this
package can make to bootstrap itself — that would be circular. If you have
never created a key for this organization before, do that in Adobe's UI now
and copy the value. You will not see it again after this step, so store it
somewhere safe until step 2.

This is why `hiberus-eds auth status` and every `eds_*` MCP tool report a
missing credential with this exact remedy, naming `hiberus-eds auth token
set`, rather than failing opaquely: the first key genuinely cannot come from
anywhere else.

## Step 2 — store the key

```sh
echo "$KEY" | hiberus-eds auth token set
```

The token is read from stdin only. There is no `--token` flag anywhere in
this CLI — a flag value lands in shell history, a pipe does not. The value
is written to `$XDG_CONFIG_HOME/hiberus/eds.json` at file mode `0600`
(default `$HOME/.config/hiberus/eds.json` if `XDG_CONFIG_HOME` is unset).

`EDS_TOKEN` always wins over the config file when both are present, which
is useful for CI or a temporary override without touching the stored file.

## Step 3 — verify reachability

```sh
export EDS_ORG=acme-demo-org
hiberus-eds auth status
```

`auth status` probes a couple of cheap read endpoints and reports a
per-probe verdict (`reachable`, `key rejected (401)`, `key lacks the
required role (403)`, `org or site not found (404)`). It never prints the
token — only an 8-hex-character fingerprint, enough to tell two keys apart
without being a credential itself.

## Step 4 — mint a narrower, day-to-day key

The bootstrap key from step 1 is broad. Mint a narrower one, carrying only
the roles routine work needs, so the powerful key stays stored away and
unused:

```sh
hiberus-eds auth mint --roles publish,author
```

API keys belong to the **organization** (`EDS_ORG`), not to a site:
`/config/{org}/apiKeys.json` is where they live, and the site-level path
answers 404. `auth mint` therefore takes no `--site` — it rejects one
rather than accepting a flag it cannot honour.

**The minted value is shown exactly once and cannot be retrieved again.**
`auth mint` prints the value alone on stdout (so `| pbcopy` or `> key.txt`
work), and everything else — a banner stating the value is unrecoverable,
the key id, its roles, its expiration, and the next command to run — goes
to stderr. Store the value immediately. Pass `--persist` to write it
straight into the credential file instead of copying it by hand; that
overwrites the currently stored key, so use it deliberately.

If the API answers without a key value, `auth mint` prints no key line at
all and exits non-zero, saying the key may still have been created — check
`hiberus-eds auth keys list` before minting again rather than retrying
blind.

```sh
hiberus-eds auth keys list
```

lists the org's keys by id, roles and expiration. It never prints key
material: the Admin API keys its records BY a secret-shaped string, and
that string is never read.

Confirmed roles (verified against `https://www.aem.live/docs/admin.html`,
the same set for both organization- and site-scoped keys): `admin`,
`config_admin`, `config`, `develop`, `author`, `publish`, `basic_author`,
`basic_publish`. Any other value is rejected before the request is sent.

## Step 5 — day-to-day operation

```sh
export EDS_ORG=acme-demo-org
export EDS_TOKEN="<the minted value>"
```

From here, `hiberus-eds auth status` and the `hiberus-eds-mcp` server both
resolve credentials the same way: `EDS_TOKEN` first, then the persisted
config file, then a `MissingCredentialError` naming this exact remedy —
never a hang.

## Running the MCP server

`hiberus-eds-mcp` requires `EDS_ORG` in its environment before any `eds_*`
tool can be called — `tools/list` works even without it, but `tools/call`
fails immediately and actionably if it is missing. Configure it like any
other stdio MCP server, passing secrets as environment variable
references, never literal values in the client config file:

```json
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": ["-y", "@hiberus-magento/eds@<version>"],
      "env": {
        "EDS_ORG": "${EDS_ORG}",
        "EDS_TOKEN": "${EDS_TOKEN}"
      }
    }
  }
}
```

## What the MCP server will never do for you

`site apply`, `site delete`, `site source set`, `key create`, `key delete`,
`auth mint`, `code show`, `code sync`, `code delete`, `version restore`,
`cache purge`, `robots show`, and `sitemap rebuild` are excluded from the
MCP surface by design — none of them have, or will ever get, a
corresponding MCP tool: minting and rotating credentials, restoring a prior
version, and repository-adjacent code operations are high blast radius or
easy for an agent to target at the wrong site, and are left to a human at
the terminal. `auth mint` is implemented as a CLI command (step 4 above);
the rest of this list has no CLI implementation in this release either —
see the project's `proposal.md` for the reasoning behind each exclusion.
