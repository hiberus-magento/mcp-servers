# Team setup — configuring these MCP servers on your own machine

The one page to send a colleague. It covers where MCP client configuration
lives, which file must never contain a secret, what each of the three servers
actually needs, and how to tell a working setup from a broken one.

The per-server onboarding docs — [eds](./eds-onboarding.md),
[aco](./aco-onboarding.md), [magento-cloud](./magento-cloud-onboarding.md) —
go deeper on each domain's own bootstrap. This page is the part that is the
same for everyone, plus the part that is different between the three and that
people get wrong.

Every example value here is synthetic. Substitute your own.

---

## 1. Which configuration file, and why it matters more than anything else

An MCP client generally offers more than one place to register a server, and
they differ in **who else can read the file**. In Claude Code:

| Scope | File | Who sees it |
| --- | --- | --- |
| Local / user | `~/.claude.json` | You, on this machine. Not in any repository. |
| Project | `.mcp.json` at the repository root | **Everyone.** It is checked into version control by design — that is its whole point. |

> **A secret written into a project-scoped `.mcp.json` gets committed.**
>
> This is the single most important sentence on this page. `.mcp.json` is
> designed to be shared so a team gets the same servers without each person
> wiring them up; a token pasted into it is a token pushed to the remote, and
> it has to be treated as compromised and rotated, not quietly deleted in a
> follow-up commit.

Shared configuration and secrets are reconciled by **`${VAR}` expansion**: the
committed file references an environment variable by name, and each person's
own environment supplies the value. That is why every generated snippet in this
repository is written as `"EDS_ORG": "${EDS_ORG}"` and never as a literal.

Pin the exact version you intend to run — the generated snippet in each
package's README on npm, and in the root [README](../README.md), already
carries the current one.

```jsonc
// .mcp.json — safe to commit: no value, only a name
{
  "mcpServers": {
    "hiberus-eds-mcp": {
      "command": "npx",
      "args": ["-y", "--package", "@hiberus-magento/eds@<version>", "hiberus-eds-mcp"],
      "env": { "EDS_ORG": "${EDS_ORG}", "EDS_TOKEN": "${EDS_TOKEN}" }
    }
  }
}
```

If your client is not Claude Code, the file names differ but the distinction
does not: find out which of your client's configuration files is
repository-scoped before you paste anything into it.

Two details that cost people time:

- **`npx` has to be told which binary to run.** Every package here ships two —
  an operator CLI and the MCP server — so the bare `npx -y <package>` form
  exits with `could not determine executable to run`. The generated snippets
  use `--package <spec> <bin>`, which is why they have four `args` and not two.
- **Your MCP client's `PATH` is not your shell's `PATH`.** A client launched
  from a desktop icon often has a much shorter one. This matters most for
  `magento-cloud`, which spawns a binary that has to be findable.

---

## 2. What each server actually needs

The three differ more than they look. The authoritative list is
[`servers.json`](../servers.json)'s `requires.env`, which records
required-vs-optional per variable and is checked against the servers' own
sources by `scripts/manifest-env.test.mjs` — if this page and that file ever
disagree, that file is right.

### `magento-cloud` — nothing in the config at all

It defers to the `magento-cloud` CLI's own stored session, so the setup is a
one-off on the machine, not a line in a config file:

```sh
magento-cloud --version   # must succeed first — this package never installs it
magento-cloud login
```

`MAGENTO_CLOUD_CLI_TOKEN` exists and is **optional**: when it is absent, the
missing-token case is caught and the CLI's own session is used instead. Set it
only for CI or an account with no interactive session.

### `eds` — an organisation, and a long-lived key

- `EDS_ORG` — **required.** Resolved on the first tool call; `tools/list` works
  without it, `tools/call` does not.
- `EDS_TOKEN` — optional *as a variable*, because the credential may instead
  come from the file in §3. A token from one source or the other is needed for
  every tool call.
- `EDS_SITE` — optional, and **read by the `hiberus-eds` CLI only**. The MCP
  server never reads it; tools take a site per call. Putting it in the server's
  config does nothing.

**Use a long-lived, org-scoped Admin API key.** Keys belong to the
organisation, not to a site: they are created with
`POST /config/{org}/apiKeys.json`, and the site-level path answers 404.
Creating one requires a key that already carries the `config_admin` role —
plain `config` is a different, narrower role and is not enough.

The very first key for an organisation can only be made in Adobe's own
admin/Sidekick UI; from there, `hiberus-eds auth mint --roles publish,author`
mints narrower day-to-day keys. A minted key carries an expiration chosen by
the API — one observed here was minted with a one-year life — and
`hiberus-eds auth keys list` prints it, so a key about to lapse is visible
before it starts failing. Prefer a minted key over anything short-lived: a
server configured with a credential that expires in hours stops working for
whoever is relying on it, not just for the person who set it up.

One tool needs more than the day-to-day roles: **`eds_get_site_config`
requires `config_admin`.** Measured against a live organisation, a key carrying
`config, author, publish` is answered 403 on the site-config paths and succeeds
on status and audit-log endpoints. If that tool is the only reason you would
widen the day-to-day key, mint a separate one for it instead.

### `aco` — two base URLs, then a credential

- `ACO_ADMIN_BASE_URL` and `ACO_MERCHANDISING_BASE_URL` — **both required, and
  checked together.** The server starts and answers `tools/list` without them,
  but the first `tools/call` fails with a *configuration* error naming both,
  not a credential error. Set them and restart.
- Then **either** `ACO_TOKEN` (a Bearer pasted from a Studio session) **or**
  `ACO_CLIENT_ID` + `ACO_CLIENT_SECRET` (IMS client credentials the server
  mints from, and re-mints on expiry). Both are `required: false` in the
  manifest because neither is required *on its own* — the schema cannot express
  "one of these".
- `ACO_API_KEY` and `ACO_IMS_ORG_ID` — optional headers (`x-api-key`,
  `x-gw-ims-org-id`), sent when set and omitted when not. Whether a given
  tenant needs them is recorded as unconfirmed.

The catalog-search tools (`aco_search_catalog`, `aco_get_facet_values`) need no
credential at all against an unprotected catalog view — but they still need the
two base URLs.

Prefer the client-credentials path: a minted token is re-minted automatically,
a pasted Studio Bearer expires and takes the server down with it. Two traps are
written up in full in [aco-onboarding.md](./aco-onboarding.md) and are worth
reading **before** you conclude the grant is broken: the credential must be
created in a Developer Console project that has the *Adobe Commerce Optimizer
Admin* API added to it, and getting an `access_token` back does not prove it
carries the `commerce.aco.admin` scope.

---

## 3. The alternative to putting a secret in any config file

You do not have to put a token in your MCP client's configuration, nor in a
shell variable. Each CLI stores one for you, and the MCP server reads the same
file:

```sh
echo "$TOKEN" | hiberus-eds auth token set
echo "$TOKEN" | hiberus-aco auth token set
echo "$TOKEN" | hiberus-magento-cloud auth token set
```

What that does, verified in `packages/mcp-core/src/credentials/resolve.ts`:

- The token is read from **stdin only**. There is no `--token` flag in any of
  these CLIs, and the argument parser rejects `--token`/`--token=` before
  anything is persisted — a flag value lands in shell history and in other
  users' `ps` output.
- It is written to `$XDG_CONFIG_HOME/hiberus/<domain>.json` (default
  `$HOME/.config/hiberus/<domain>.json`), created in a directory made `0700`,
  via a temp file at mode `0600` and an atomic rename.
- On read, the file's mode must be **exactly `0600`**. Anything else — not just
  looser — is refused outright with
  `Refusing to read credential file "…": mode <mode> has group/world permissions.`
  It is a refusal, not a warning.

Resolution order is `ENV_VAR` → that file → fail. There is no third branch and
nothing ever prompts, so a missing credential is always an immediate, named
error rather than a hang.

The credential file is re-read on every call, never cached at process startup.
Pasting a fresh token while the MCP server is already running takes effect on
the very next tool call — no restart.

---

## 4. Checking it works

Start with the CLI, not the MCP client: it gives you a plain answer on a
terminal instead of a tool error inside an agent.

```sh
export EDS_ORG=acme-demo-org
npx -y --package @hiberus-magento/eds hiberus-eds auth status
npx -y --package @hiberus-magento/aco hiberus-aco auth status
npx -y --package @hiberus-magento/magento-cloud hiberus-magento-cloud auth status
```

- `hiberus-eds auth status` probes a couple of cheap read endpoints and reports
  a per-probe verdict. It never prints the token — only an 8-hex-character
  fingerprint, enough to tell two keys apart.
- `hiberus-aco auth status` reports which credential it selected and why
  (`selection: minted` / `selection: pasted-bearer`).
- `hiberus-magento-cloud auth status` wraps the upstream CLI's own
  `auth:info --no-auto-login` and never prints the token under any outcome.

Then, in your MCP client: `tools/list` should answer for all three servers even
with nothing configured. That is deliberate — configuration is resolved on the
first `tools/call`, so a configuration problem shows up as a named tool error
and never as a server that fails to start.

## 5. What the common failures mean

| What you see | What it means |
| --- | --- |
| `Missing credential for domain "<d>"` — with `Run:`, `Or set:` and `Checked:` lines | No token in the environment variable and none in the credential file. The message names the exact command, variable and path it looked at. |
| `Credential expired for domain "<d>"` | A pasted Bearer's decoded `created_at`/`expires_in` has elapsed. The call is refused *before* any request is sent. Paste a fresh one, or switch to the minting path. |
| `Refusing to read credential file …: mode <m> has group/world permissions` | The stored credential's file mode is not `0600`. `chmod 600` it, or re-run `auth token set`. |
| `the EDS_ORG environment variable is required to call any eds_* tool` | `EDS_ORG` is unset or empty. Set it and restart the server — it is resolved once per process. |
| `ACO_ADMIN_BASE_URL and ACO_MERCHANDISING_BASE_URL are both required` | A *configuration* error, not a credential one. Set both and restart. |
| `"magento-cloud" was not found on the configured PATH` | Detected before any process is spawned. Usually the MCP client's `PATH`, not yours — see §1. |
| `The Magento Cloud CLI is not authenticated` | Names the easier exit first: `magento-cloud login`. The headless exit is `MAGENTO_CLOUD_CLI_TOKEN`, or `hiberus-magento-cloud auth token set`. |
| An EDS `401` | The key was not accepted at all. Wrong or revoked key. |
| An EDS `403` | The key was accepted and lacks the role. Usually `config_admin` — see §2. |
| An EDS `404` | **An addressing problem, not a permissions one**, and the error says so. Check the org, site, ref and path spelling. |
| Any other EDS HTTP status | No longer surfaces as a JSON parse error. The error carries the status, the method and path that produced it, a bounded excerpt of whatever the body said (or "The response body was empty."), and a remedy: a `4xx` says retrying unchanged will fail the same way, a `5xx` says retry later. |
| An ACO error whose remedy says `heuristic classification` | Adobe publishes no structured code for that case, so the classification is inferred. The remedy still names the exits — for a scope problem, both re-minting and pasting a Studio Bearer. |

---

## 6. If a tool says it was never run

Some tools in the generated listings carry **Not verified against a live
service**, with a sentence saying what was not exercised. That records what was
run, not a defect: each is covered by unit tests and by this repository's
conformance suite, and nothing marked is known to be broken. Absence of the
marker records no claim either way — it is not a verification badge. Treat a
marked destructive tool the way you would treat any untested destructive
operation.
