# ACO onboarding

The day-one bootstrap sequence for `@hiberus-magento/aco` — the
`hiberus-aco` CLI and the `hiberus-aco-mcp` server. This domain has two
independent tiers, and the bootstrap for each is genuinely different:

- **Tier A** (`aco_search_catalog`, `aco_get_facet_values`) talks to the
  Merchandising surface and needs **no credential at all** for an
  unprotected catalog view. There is nothing to bootstrap for it.
- **Tier B** (`aco_list_catalog_views`, `aco_list_price_books`,
  `aco_list_policies`, `aco_toggle_policy`) talks to the admin GraphQL
  surface and needs an admin Bearer. Everything below is about getting that
  Bearer, correctly, on the first try.

## The one step that trips everyone (read this before anything else)

**Add the "Adobe Commerce Optimizer Admin" API to the Developer Console
project, and create an OAuth Server-to-Server credential *there*** — not in
a project that lacks it.

A credential minted from a project that does not have that API added fails
`client_credentials` with `unauthorized_client`, even for the bare
`openid,AdobeID` scope with no ACO scope requested at all. That failure
reads exactly like a broken or unavailable grant. **It is not one.** It is a
project configuration gap, and the fix is adding the API to the project, not
switching auth strategy.

This is not a hypothetical warning: this programme spent a full week
believing the `client_credentials` grant did not work for this tenant
because of exactly this failure, and a pre-existing internal Python CLI for
the same tenant had carried the identical wrong conclusion as a code comment
for longer than that. Once the API was added to the project and a fresh
OAuth Server-to-Server credential was created against it, the grant worked
immediately.

So, in order:

1. In Adobe Developer Console, open the project you intend to use (or
   create one).
2. Add the **Adobe Commerce Optimizer Admin** API to that project.
3. Create an **OAuth Server-to-Server** credential inside that same project.
4. Note the credential's client id and client secret — you will store these
   as `ACO_CLIENT_ID` / `ACO_CLIENT_SECRET`, never as CLI flags (see Step 2
   below for why).

If you already have a client id/secret pair from a project created *before*
adding that API, it will keep failing until you either add the API to that
same project or create a new credential in a project that already has it.
Adding the API to an existing project is sufficient — you do not need a new
credential if you can add the API to the one you already have.

## Step 1 — configure the minted (mint) path (the normal path)

```sh
read -rs ACO_CLIENT_ID
export ACO_CLIENT_ID
read -rs ACO_CLIENT_SECRET
export ACO_CLIENT_SECRET
```

`read -rs` reads the value silently from your terminal and assigns it
directly to the environment — it never touches shell history, and it never
appears as a process argument another user on the same host could read from
`ps`. There is no `--client-id`/`--client-secret` flag on this CLI for the
same reason there is no `--token` flag: a flag value lands in shell history
and process listings, an environment variable set this way does not.

With both set, `hiberus-aco-mcp` and `hiberus-aco` mint an admin token on
first use and re-mint automatically on expiry — Tier B stays available for
the life of the process with no human back-and-forth. Two concurrent calls
that both find an expired token trigger exactly one mint (`getToken()`
coalesces), never a stampede.

## Step 2 — verify the grant actually carries the ACO scope (do not skip this)

**Getting an `access_token` back proves nothing about the admin scope on
its own.** Adobe's IMS can return a valid, well-formed `200` response whose
`access_token` carries *fewer* scopes than you requested — with no error,
no warning, nothing to catch in a status code. A credential missing the ACO
scope and a fully working one look identical at the "did I get a token"
level. This is the second thing that cost real time on this programme to
discover, and it is why `hiberus-aco auth mint` alone is not sufficient
verification.

Mint one and decode it yourself:

```sh
hiberus-aco auth mint
```

`auth mint` prints only a confirmation (`Minted an admin credential (kind:
minted).`) — it never prints the token value itself, by design, the same
way `auth status` never prints a stored Bearer. To inspect the actual
granted scope, decode the JWT payload segment directly. A JWT is
`header.payload.signature`; the payload is the second, base64url-encoded
segment:

```sh
echo "$ACO_MINTED_TOKEN" | cut -d. -f2 | tr '_-' '/+' | base64 -d | jq .scope
```

(If your token string doesn't include padding, `base64 -d` on some
platforms is stricter about padding than others — `base64 -di` on macOS or
piping through `python3 -c 'import sys,base64;
print(base64.urlsafe_b64decode(sys.stdin.read()+"=="))'` both work as a
fallback if the direct decode complains.)

A verified working result looks like this:

```json
"commerce.aco.admin,openid,AdobeID"
```

If `commerce.aco.admin` is **absent** from that string, the credential
minted successfully but does not actually carry the scope this domain needs
— go back to the Developer Console step above and confirm the API was added
to the project the credential id/secret actually belong to.

## Step 3 — day-to-day operation

Once Step 1's environment variables are set and Step 2 has confirmed the
scope, there is nothing further to do. `hiberus-aco auth status` reports
the current selection and why:

```sh
hiberus-aco auth status
# selection: minted
# reason: No stored/env Bearer is present; minting via ACO_CLIENT_ID/ACO_CLIENT_SECRET.
```

## The override path — a pasted Studio Bearer, for an operator without Console access

Not every operator has Adobe Developer Console access. For that case, a
Studio session Bearer can be pasted directly instead of minting one:

```sh
read -rs ACO_TOKEN
echo "$ACO_TOKEN" | hiberus-aco auth token set
unset ACO_TOKEN
```

The value is read from **stdin only** — there is no `--token` flag anywhere
in this CLI, for the same shell-history/process-argument reason as Step 1.
It is written to `$XDG_CONFIG_HOME/hiberus/aco.json` at file mode `0600`
(default `$HOME/.config/hiberus/aco.json` if `XDG_CONFIG_HOME` is unset).

**A stored or env Bearer always wins over client credentials, unconditionally**,
once one is present — `auth status` will report `selection: pasted-bearer`.
This is deliberate: an operator only pastes a Bearer on purpose, and letting
a mint attempt silently override it would re-break the working path on
every call. If you want to go back to the mint path, remove the stored file
and unset `ACO_TOKEN` first.

A pasted Bearer eventually expires. This package checks its decoded
`created_at`/`expires_in` claims (no signature verification — it trusts the
value the same way the browser session that produced it did) and rejects a
call with `CredentialExpiredError` **before** any request is sent once it
has elapsed. The credential file is re-read on every call, never cached at
process startup, so pasting a fresh value with `hiberus-aco auth token set`
while `hiberus-aco-mcp` is already running restores Tier B on the very next
tool call — no restart needed.

## Running the MCP server

`hiberus-aco-mcp` needs no environment variable to start — `tools/list`
works immediately, and Tier A tools (`aco_search_catalog`,
`aco_get_facet_values`) work with zero configuration against an unprotected
catalog view. Only a Tier B tool call needs `ACO_CLIENT_ID`/`ACO_CLIENT_SECRET`
(or a stored/`ACO_TOKEN` Bearer) to be present, and if neither is
configured, that call fails immediately and actionably — never a hang —
naming `hiberus-aco auth token set` as the remedy.

```json
{
  "mcpServers": {
    "hiberus-aco-mcp": {
      "command": "npx",
      "args": ["-y", "@hiberus-magento/aco@<version>"],
      "env": {
        "ACO_CLIENT_ID": "${ACO_CLIENT_ID}",
        "ACO_CLIENT_SECRET": "${ACO_CLIENT_SECRET}"
      }
    }
  }
}
```

Never write a real client id, secret, or Bearer value into a client config
file — pass them as environment variable references, exactly as shown
above, and let your MCP client resolve them from its own environment.

## What the MCP server will never do for you

`provision`, `policy disable --all`, `policy delete`, `policy init`,
`view delete`, `view prune`, `api query`, and every `auth`/`profile`
subcommand are excluded from the MCP surface by design — none of them have,
or will ever get, a corresponding MCP tool. Bulk provisioning, destructive
deletes, and interactive credential management are high blast radius or
inherently require a human confirming a destination, and are left to a
human at the terminal via `hiberus-aco`. `aco_toggle_policy` is the one
mutating MCP tool this server exposes, and it operates only on explicitly
named policies — there is no "apply to all" mode anywhere on the MCP
surface.
