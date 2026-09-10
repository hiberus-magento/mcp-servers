# EDS CLI Specification

## Purpose

Defines the `hiberus-eds` CLI adapter (`packages/eds/src/cli.ts`): command
surface, stdin-only token intake, credential precedence for the `eds`
domain, `auth mint`'s one-time-secret handling, `auth status` probing, exit
codes, and the operations excluded from the MCP surface.

## Requirements

### Requirement: Stdin-Only Token Intake

`hiberus-eds auth token set` MUST read the token exclusively from stdin. No
flag or positional argument MAY carry a token value anywhere in the CLI,
because an argument lands in shell history.

#### Scenario: Token piped via stdin is accepted

- GIVEN `echo "$KEY" | hiberus-eds auth token set`
- WHEN the command runs
- THEN the token is read from stdin and persisted

#### Scenario: Token as a command-line argument is rejected

- GIVEN an invocation such as `hiberus-eds auth token set --token abc123`
  or a positional token argument
- WHEN the CLI's argument parser processes it
- THEN it rejects the invocation before persisting anything and instructs
  the caller to use stdin instead

### Requirement: Credential Precedence for the eds Domain

Reading a credential for the `eds` domain MUST resolve `EDS_TOKEN` over the
config file at `$XDG_CONFIG_HOME/hiberus/eds.json`, and persisting one via
`auth token set` MUST write that file at mode `0600`.

#### Scenario: EDS_TOKEN wins over the config file

- GIVEN both `EDS_TOKEN` and a value in
  `$XDG_CONFIG_HOME/hiberus/eds.json` are present
- WHEN any command resolves the credential
- THEN it uses the `EDS_TOKEN` value

#### Scenario: Persisted token file has restrictive permissions

- GIVEN `auth token set` persists a token
- WHEN the file is written
- THEN `$XDG_CONFIG_HOME/hiberus/eds.json` is created at mode `0600`

### Requirement: Minted Key Is Shown Once and Unrecoverable

`auth mint` MUST print the minted key value on its own, MUST state plainly
that the value cannot be retrieved again, and MUST instruct the operator to
store it before continuing.

#### Scenario: Mint output states the value is unrecoverable

- GIVEN `hiberus-eds auth mint --scope example-site --roles author`
- WHEN the command succeeds
- THEN its output prints the minted value and a message stating it will
  never be shown again

### Requirement: Auth Status Never Echoes the Key

`auth status` MUST probe multiple read endpoints and report a per-probe
result, and MUST NOT print the key value in any output stream under any
outcome.

#### Scenario: Status output contains no key value

- GIVEN a valid token
- WHEN `hiberus-eds auth status` runs
- THEN its output reports each probe's result and never contains the token
  value

### Requirement: CLI-Only Operations Excluded from MCP

`site apply`, `site delete`, `site source set`, `key create`, `key delete`,
`auth mint`, `code show`, `code sync`, `code delete`, `version restore`,
`cache purge`, `robots show`, and `sitemap rebuild` MUST exist only as CLI
commands; none MAY have a corresponding MCP tool registration.

#### Scenario: CLI-only command has no MCP tool

- GIVEN the list of CLI-only operations
- WHEN the MCP server's `tools/list` response is inspected
- THEN no tool corresponds to any operation on that list

### Requirement: Exit Codes Reflect Outcome

The CLI MUST exit `0` on success and a non-zero code on any failure,
including a rejected argument, a missing credential, or an API error.

#### Scenario: Failure exits non-zero

- GIVEN a command that fails (e.g. a missing credential)
- WHEN the process exits
- THEN its exit code is non-zero
