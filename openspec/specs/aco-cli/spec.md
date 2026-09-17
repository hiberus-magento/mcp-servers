# ACO CLI Specification

## Purpose

Defines the `hiberus-aco` CLI adapter (`packages/aco/src/cli.ts`): admin
credential intake, mint-then-paste precedence, `provision`'s dry-run
default, and the operations excluded from the MCP surface.

## Requirements

### Requirement: Admin Credential Never Accepted as a CLI Argument

No admin-track credential value (a pasted Bearer, or an IMS client
id/secret) MAY be accepted as a command-line flag or positional argument
anywhere in the CLI. `auth token set` MUST read the Bearer from stdin
only; the client id/secret MUST be read from environment variables only.

#### Scenario: Token piped via stdin is accepted

- GIVEN `echo "$BEARER" | hiberus-aco auth token set`
- WHEN the command runs
- THEN the token is read from stdin and persisted

#### Scenario: Token as a command-line argument is rejected

- GIVEN an invocation such as `hiberus-aco auth token set --token abc123`
- WHEN the CLI's argument parser processes it
- THEN it rejects the invocation before persisting anything and instructs
  the caller to use stdin instead

### Requirement: Credential Precedence and File Permissions

Reading the admin credential MUST resolve an environment variable over the
config file at `$XDG_CONFIG_HOME/hiberus/aco.json`, and persisting one via
`auth token set` MUST write that file at mode `0600`.

#### Scenario: Persisted token file has restrictive permissions

- GIVEN `auth token set` persists a pasted Bearer
- WHEN the file is written
- THEN `$XDG_CONFIG_HOME/hiberus/aco.json` is created at mode `0600`

### Requirement: Mint-Then-Paste With a Dual-Exit Scope Failure

When an IMS `client_credentials` mint attempt fails on a scope/permission
error, the CLI MUST surface a `MissingCredentialError` naming BOTH exits —
re-attempting the mint and pasting a Studio session Bearer — never a
generic network error.

#### Scenario: Scope failure names both remedies

- GIVEN a configured client id/secret whose mint attempt fails with a
  scope-shaped error
- WHEN any admin command resolves the credential
- THEN the resulting error text names both re-attempting the mint and
  pasting a Studio Bearer

### Requirement: Pasted Bearer Expiry Is Checked Before Any Request

A pasted Bearer's `created_at`/`expires_in` claims MUST be decoded without
signature verification purely to compute expiry, and `CredentialExpiredError`
MUST be thrown before any request is issued once elapsed.

#### Scenario: Expired pasted Bearer blocks the request

- GIVEN a persisted Bearer whose decoded `expires_in` has elapsed
- WHEN an admin command runs
- THEN `CredentialExpiredError` is thrown and the fetch double records zero
  calls

### Requirement: provision Defaults to Dry-Run

`hiberus-aco provision` MUST default to dry-run and MUST require an
explicit `--yes` flag to issue any write.

#### Scenario: No flag means no writes

- GIVEN `hiberus-aco provision <args>` with no `--yes` flag
- WHEN the command runs
- THEN zero mutation requests are issued and the output states this was a
  dry run

### Requirement: CLI-Only Operations Excluded from MCP

`provision` (including dry-run), `policy disable --all`, `view prune`,
`view delete`, `policy delete`, `auth`/`profile` subcommands, `api query`,
and `policy init` MUST exist only as CLI commands; none MAY have a
corresponding MCP tool registration.

#### Scenario: CLI-only command has no MCP tool

- GIVEN the list of CLI-only operations
- WHEN the MCP server's `tools/list` response is inspected
- THEN no tool name corresponds to any operation on that list

### Requirement: Exit Codes Reflect Outcome

The CLI MUST exit `0` on success and non-zero on any failure, including a
rejected argument, a missing/expired credential, or an API error.

#### Scenario: Failure exits non-zero

- GIVEN a command that fails due to a missing credential
- WHEN the process exits
- THEN its exit code is non-zero
