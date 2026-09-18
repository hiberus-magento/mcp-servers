# Magento Cloud onboarding

The day-one bootstrap sequence for `@hiberus-magento/magento-cloud` — the
`hiberus-magento-cloud` CLI and the `hiberus-magento-cloud-mcp` server. This
package wraps the **real, third-party [Magento Cloud
CLI](https://github.com/platformsh/legacy-cli)** — it is a prerequisite,
never installed or bundled by this package itself. Every example below uses
synthetic identifiers (`acme-demo-project`, `acme-demo-env-main`,
`demo-host.example-domain`); substitute your own project and environment.

## Step 0 — install the Magento Cloud CLI (prerequisite, outside this package)

This package never installs, bundles, or vendors the `magento-cloud`
binary. Install it yourself first, following its own installation
instructions, and confirm it is on `PATH`:

```sh
magento-cloud --version
```

If this command fails with "command not found", `hiberus-magento-cloud`
and every `magentocloud_*` MCP tool will fail the same way — see "Failure
mode 1" below for exactly what that looks like and how to recover.

## Step 1 — get an API token (outside this package)

An API token comes from your Magento Cloud / Adobe Commerce on Cloud
account settings — there is no API call this package can make to bootstrap
one; that would be circular. Generate a token there and copy it before
continuing.

## Step 2 — store the token

```sh
echo "$TOKEN" | hiberus-magento-cloud auth token set
```

The token is read from stdin only. There is no `--token` flag anywhere in
this CLI — a flag value lands in shell history and process listings, a pipe
does not (`hiberus-magento-cloud auth token set --token abc123` is rejected
before persisting anything). The value is written to
`$XDG_CONFIG_HOME/hiberus/magento-cloud.json` at file mode `0600` (default
`$HOME/.config/hiberus/magento-cloud.json` if `XDG_CONFIG_HOME` is unset).

`MAGENTO_CLOUD_CLI_TOKEN` always wins over the config file when both are
present — useful for CI or a temporary override without touching the
stored file.

## Step 3 — verify

```sh
export MAGENTO_CLOUD_CLI_TOKEN=... # or rely on the stored file from Step 2
hiberus-magento-cloud auth status
```

`auth status` wraps `auth:info --no-auto-login` and never prints the token
value in its output under any outcome — only the account id, email, and
username it reports back. It is also the one `magentocloud_*` MCP tool that
tolerates an absent credential entirely (`magentocloud_auth_status`): it
needs no token to run, because reporting `authenticated: false` is its
entire job.

## The three failure modes, and exactly what to do about each

Every `magentocloud_*` tool call and every `hiberus-magento-cloud`
subcommand classifies a failure into one of three named shapes before ever
returning a generic, unhelpful error. Each names its own remedy — none is
ever collapsed into the other two.

### Failure mode 1 — CLI not installed

**What you see:** a message naming the `magento-cloud` binary and pointing
back to Step 0 above (`MagentoCloudNotInstalledError` internally). This is
detected **before any process is spawned** — the binary is resolved off an
explicit `PATH` walk first, so a missing CLI can never be silently
collapsed into a generic subprocess failure.

**What to do:** install the Magento Cloud CLI (Step 0) and confirm
`magento-cloud --version` succeeds in the same shell/environment this
package runs in. A common cause in an MCP client context is that the
client process's own `PATH` does not include the directory the CLI was
installed to — check the MCP client's own environment, not just your
interactive shell's.

### Failure mode 2 — not authenticated

**What you see:** a message naming `MAGENTO_CLOUD_CLI_TOKEN` and
`hiberus-magento-cloud auth token set` as the remedy
(`MagentoCloudNotAuthenticatedError` internally), detected from the real
CLI's own non-interactive "Not logged in" / "authenticate
non-interactively" stderr text after a real spawn.

**What to do:** run Step 2 again with a fresh token, or set
`MAGENTO_CLOUD_CLI_TOKEN` directly if you are running this in CI. Every
`magentocloud_*` tool re-reads the credential per call — never cached at
process startup — so fixing this while `hiberus-magento-cloud-mcp` is
already running takes effect on the very next call, no restart needed.

### Failure mode 3 — unsupported CLI version (warn-only)

**What you see:** this check ships **warn-only, never blocking** — an
unparseable or below-minimum version does not fail a call. This package's
`MINIMUM_SUPPORTED_CLI_VERSION` is set to the real, observed value **`Magento
Cloud CLI 1.47.0`**, confirmed by running `magento-cloud --version` against
a real installed CLI during this package's own development (a `--version`
call that had never actually been run before that point — an earlier,
unverified guess of `5.3.1` turned out to be wrong, both in format and
value). If you run an older or newer CLI, that alone will never block a
tool call; only Failure modes 1 and 2 do.

**What to do:** nothing is required. If you want to confirm you are on a
version this package has actually been exercised against, run
`magento-cloud --version` yourself and compare against `1.47.0`.

## Running the MCP server

`hiberus-magento-cloud-mcp` needs no environment variable to start —
`tools/list` works immediately, and `magentocloud_auth_status` works with
zero configuration (it is the one tool that tolerates an absent
credential). Every other tool needs `MAGENTO_CLOUD_CLI_TOKEN` (or a stored
credential file from Step 2) to be present, and if neither is configured,
that call fails immediately and actionably — never a hang — naming
`hiberus-magento-cloud auth token set` as the remedy.

```json
{
  "mcpServers": {
    "hiberus-magento-cloud-mcp": {
      "command": "npx",
      "args": ["-y", "@hiberus-magento/magento-cloud@<version>"],
      "env": {
        "MAGENTO_CLOUD_CLI_TOKEN": "${MAGENTO_CLOUD_CLI_TOKEN}"
      }
    }
  }
}
```

Never write a real token value into a client config file — pass it as an
environment variable reference, exactly as shown above, and let your MCP
client resolve it from its own environment.

## What the MCP server will never do for you

`ssh`, every `tunnel:*` form (`tunnel:list`/`open`/`close`/`info`/`single`),
`db:dump`, and the CLI's own generic REST passthroughs
(`api:curl`/`project:curl`/`organization:curl`/`environment:curl`) are
excluded from the MCP surface by design — none of them have, or will ever
get, a corresponding MCP tool. `auth token set` and the raw (unstripped)
`environment:relationships` display (which may include live service
credentials) are CLI-only for the same reason: an interactive human at a
terminal can be trusted to view a credential; an autonomous MCP client
cannot be assumed to be one.

`magentocloud_query_database` is the one tool that reaches the database at
all, and it is intentionally narrow: a `{ kind: "size" }` usage check, or a
single, guarded `SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN` statement. Every write
verb, a bare `*` projection (except `COUNT(*)`), and every file-exfiltration
form (`INTO OUTFILE`/`INTO DUMPFILE`/`LOAD_FILE(`) is rejected before any
process is spawned. A `SELECT` with no `LIMIT` gets a `LIMIT 200` injected
automatically; `rowsReturned === rowCap` in the result is your signal that
more rows exist.

## What the checked-in test fixtures can and cannot prove

This package ships a checked-in fake `magento-cloud` binary
(`test/fake-bin/`) used only by this package's own automated tests — it is
never published (there is no `test/` entry in the published tarball). It
proves argv building, environment assembly against a real child process,
real spawn/pipe/timeout/byte-cap kills, and stdout isolation. **It cannot
prove that the real, installed Magento Cloud CLI accepts any given argv
shape, or that its real output still matches these canned fixtures** — only
a human, running the checklist below against the real CLI, can confirm
that.

## Manual acceptance checklist (human gate — run once before publishing a new version)

This is a human gate, not a test pretending to be one. Run it once, by
hand, against a real Magento Cloud project before publishing:

- [ ] `magento-cloud --version` succeeds and reports a version; record it
      and today's date below.
- [ ] `hiberus-magento-cloud auth token set` (Step 2) succeeds with a real
      token.
- [ ] `hiberus-magento-cloud auth status` reports `authenticated: true`
      against the real account.
- [ ] `magentocloud_list_projects`, `magentocloud_describe_project`,
      `magentocloud_list_environments`, and `magentocloud_describe_environment`
      each return real data shaped as this package's parsers expect (a
      column rename or reorder in the real CLI's output would surface as a
      loud, named `MagentoCloudOutputShapeError` naming the exact file to
      edit — confirm you see real data, not that error).
- [ ] `magentocloud_get_environment_config` with
      `include: ["serviceEndpoints"]` against a real environment returns
      `host`/`port`/`scheme`/`service` only — confirm no credential field
      leaked through.
- [ ] `magentocloud_query_database` with `{ kind: "size" }` returns real
      usage stats.
- [ ] `magentocloud_query_database` with a real, bounded `SELECT ... LIMIT
      5` against a real table returns real rows.
- [ ] `hiberus-magento-cloud environment:relationships` (CLI-only) is
      confirmed to still include real credential fields, unstripped —
      exactly as designed, and exactly why it is never exposed as an MCP
      tool.

**Fixture re-capture procedure**, if the real CLI's output shape has
drifted from `test/fake-bin/fixtures/*.txt`: re-run the corresponding
`magento-cloud` subcommand with the SAME flags `src/client/commands.ts`
builds for it — `--format=tsv` for the tabular and key/value reads, `--raw`
for `db:sql`, `--pipe` for `environment:url`, and no format flag at all for
`environment:relationships`, `app:config-get` and `activity:log`.
`environment:url` and `environment:relationships` reject `--format`
outright (`The "--format" option does not exist.`), so a fixture captured
with it is not the output the client will ever see — which is how the
original fixture corpus came to describe a CLI that does not exist. Run it
against a real project, copy its real stdout into the matching fixture
file under `test/fake-bin/fixtures/`, and record the CLI version and date
below. Never copy a real project id, environment name, hostname, or token
into a fixture — replace them with the synthetic identifiers from
`packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`
(`SYNTHETIC_MC_PROJECT_ID`, `SYNTHETIC_MC_ENVIRONMENT_IDS`, `SYNTHETIC_MC_TOKEN`,
`SYNTHETIC_MC_HOST`) first — this repository is public.

**Last recorded real `--version` output:** `Magento Cloud CLI 1.47.0`, 2026-09-17.
