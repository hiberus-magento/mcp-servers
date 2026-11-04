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
`POST /config/{org}/apiKeys.json` is where they are created and where they
live, and the site-level path answers 404. `auth mint` therefore takes no
`--site` — it rejects one rather than accepting a flag it cannot honour.

Minting needs a key that already carries `config_admin`. A key holding
`config` is not enough: `config` and `config_admin` are separate roles, and
only the latter may read or write anything under `/config/{org}/`. If the
bootstrap key from step 1 was issued without `config_admin`, `auth mint`
answers 403 and the key has to be widened in Adobe's UI first.

A minted key carries an `expiration` chosen by the API, not by this CLI —
one key observed here was minted with a one-year life. `auth keys list`
prints it, so a key that is about to lapse is visible before it starts
failing.

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
      "args": ["-y", "--package", "@hiberus-magento/eds@<version>", "hiberus-eds-mcp"],
      "env": {
        "EDS_ORG": "${EDS_ORG}",
        "EDS_TOKEN": "${EDS_TOKEN}",
        "EDS_PROTECTED_SITES": "acme-demo-site-us"
      }
    }
  }
}
```

The package declares two binaries, so `npx` must be told which one to run
(`--package … hiberus-eds-mcp`). The bare `npx -y @hiberus-magento/eds@<version>`
form exits with "could not determine executable to run".

`EDS_PROTECTED_SITES` is optional. It takes a comma-separated list of site-name
patterns, where `*` is the only wildcard and matching is anchored and
case-sensitive. Before a change to a matching site is applied, the user has to
type that site's name.

## Changing a site: plan, confirm, apply

Every change goes through two tools:

1. **`eds_plan`** changes nothing. It returns:
   - exactly what would happen: the requests and, for configuration, every
     changed key with its value before and after;
   - the warnings;
   - a `confirmationMessage` for the model to show you;
   - a one-time token.
2. **You confirm** in the conversation, typing the site name if it is
   protected.
3. **`eds_apply`** takes the token plus the plan's site and kind, which must
   match, and sends exactly the planned requests. Your client's approval dialog
   shows that site and kind; read them before approving.

A token expires after ten minutes and works once. If something changed between
the plan and the apply, for example someone else edited the configuration, the
apply writes nothing and asks for a new plan.

## Confirming `eds_apply` in your client

The token makes sure that what is applied is what was planned. Whether a human
actually said yes depends on the model following the plan's instruction, and on
the client asking you before `eds_apply` runs. **No client asks because of
`destructiveHint` alone**, so set it up per client:

| Client | Setting | Where | What still bypasses it |
| --- | --- | --- | --- |
| Claude Code | Nothing to configure. `eds_apply` is marked `anthropic/requiresUserInteraction`, so Claude Code asks on every call, with no "don't ask again". Optionally add `{ "permissions": { "ask": ["mcp__eds__eds_apply"] } }` | `.claude/settings.json` or `~/.claude/settings.json` | Nothing. In `dontAsk` mode the call is denied instead |
| VS Code Copilot | `{ "chat.tools.eligibleForAutoApproval": { "eds_apply": false } }` | User `settings.json` | The *Allow all* and *Autopilot* permission levels, and `/yolo` |
| opencode | `{ "permission": { "eds_*": "allow", "eds_eds_apply": "ask" } }`, with the specific rule **after** the wildcard, because the last match wins | `opencode.json` or `~/.config/opencode/opencode.json` | A saved "always" answer (only `deny` holds against it), and `--auto` |

In VS Code the key is the bare tool name, so a tool called `eds_apply` on
another server would match it too. `eds_plan` and the read tools carry
`readOnlyHint`, so VS Code runs them without asking, which is intended: they
change nothing.

Avoid the bypass modes in the table for sessions that can reach a production
site. `EDS_PROTECTED_SITES` adds a site-name check, but the model sends that name:
it stops a model aiming at the wrong site, not one told "don't ask me". The
client's dialog is the step only you can take.

## Which role each tool needs

The day-to-day roles from step 4 (`publish`, `author`) cover status, the audit
log, snapshots, jobs, and planning and applying content changes. Anything under
`/config/{org}/` does not:

- **`eds_get_site_config` requires `config_admin`.** `config` is a different,
  narrower role and does not open these paths. Measured against a live
  organization: a key carrying `config, author, publish` is answered 403 on
  both `/config/{org}/sites/{site}.json` and `/config/{org}/sites/{site}/cdn.json`,
  and the same key succeeds on the status and audit-log endpoints. If this
  tool is the only one you need `config_admin` for, consider minting a
  separate key for it rather than widening the day-to-day one.

- **Inferred from the path, not measured:** the other tools and operations that
  read or write under `/config/{org}/` need `config_admin` too:
  - `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`,
    `eds_list_api_keys` and `eds_get_code_status`;
  - the `config.patch`, `site.*`, `version.restore`, `robots.set` and `code.*`
    plans.

  `preview.*` and `live.*` plans read the site document only to check for an AEM
  content source. Without `config_admin` they skip the check and say so in a
  warning.

`hiberus-eds auth status` reports `key lacks the required role (403)`
per probe, which is the quickest way to tell a role problem from a
credential problem.

## What has not been verified against a live service

Everything in this package is covered by unit tests and by the shared
conformance suite. The gaps below are also recorded in `servers.json`, in the
generated README and in the tools' own descriptions, so they are visible wherever
the decision to use them is made. This is a statement about what was run, not a
report of a defect: nothing below is known to be broken.

- **`eds_apply`, partly.** These kinds have run against a live organization:
  - `site.create`, `config.patch`, `version.restore`, `robots.set` and
    `site.delete`, on a throwaway site;
  - `snapshot.add` and `snapshot.delete`, as a reversible pair under 0.1's
    `eds_manage_snapshot`.

  The others have not. The content kinds (`preview.*`, `live.*`, `index.*`)
  were left out on purpose: the throwaway site shared its content source with a
  real one, so publishing there would have published on that site too. The
  same goes for `cache.purge`, `sitemap.rebuild`, `code.*`, `job.stop`, and
  snapshot publish, review and remove. All of these are built from the Admin
  API contract. The AEM warning has been seen on a real plan, which was not
  applied.
- **Secrets in a site document: partly.** On a live site, a `config.patch` left
  a hashed site secret intact. The Admin API returns `secrets` as metadata only
  and keeps the secret when that metadata is sent back unchanged. The deprecated
  `tokens` entry has not been exercised. The plan still names `secrets` or
  `tokens` in a warning when the document has them.
- **Clients other than Claude Code.** The confirmation flow has been run in
  Claude Code only. The VS Code Copilot and opencode settings above come from
  those clients' documentation and source code.

## What the MCP server will never do for you

- **Create or delete API keys.** `auth mint` (step 4) shows the new key value
  once. Over MCP, that value would land in the model's context and transcript.
  Deleting a key is an org-level operation that does not fit a site-scoped plan.
  This release's CLI does not implement key deletion: delete keys in Adobe's
  admin UI.
- **Project-specific orchestration.** Generating a site document from a site
  model, or applying one change to many sites, belongs in the consuming
  project, which can compose `eds_plan` operations.
