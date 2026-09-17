# Magento Cloud CLI Specification

## Purpose

Defines the `hiberus-magento-cloud` CLI adapter (`packages/magento-cloud/src/cli.ts`):
command surface, stdin-only token intake for `MAGENTO_CLOUD_CLI_TOKEN`,
credential precedence, `auth status` probing, the raw (unstripped)
`environment:relationships` output, and the operations excluded from the
MCP surface.

## Requirements

### Requirement: Stdin-Only Token Intake

`hiberus-magento-cloud auth token set` MUST read the token exclusively from
stdin. No flag or positional argument MAY carry a token value anywhere in
the CLI, because an argument lands in shell history.

#### Scenario: Token piped via stdin is accepted

- GIVEN `echo "$TOKEN" | hiberus-magento-cloud auth token set`
- WHEN the command runs
- THEN the token is read from stdin and persisted

#### Scenario: Token as a command-line argument is rejected

- GIVEN an invocation such as
  `hiberus-magento-cloud auth token set --token abc123`
- WHEN the CLI's argument parser processes it
- THEN it rejects the invocation before persisting anything and instructs
  the caller to use stdin instead

### Requirement: Credential Precedence for the magento-cloud Domain

Reading a credential for the `magento-cloud` domain MUST resolve
`MAGENTO_CLOUD_CLI_TOKEN` over the config file at
`$XDG_CONFIG_HOME/hiberus/magento-cloud.json`, and persisting one via
`auth token set` MUST write that file at mode `0600`.

#### Scenario: MAGENTO_CLOUD_CLI_TOKEN wins over the config file

- GIVEN both `MAGENTO_CLOUD_CLI_TOKEN` and a value in
  `$XDG_CONFIG_HOME/hiberus/magento-cloud.json` are present
- WHEN any command resolves the credential
- THEN it uses the `MAGENTO_CLOUD_CLI_TOKEN` value

#### Scenario: Persisted token file has restrictive permissions

- GIVEN `auth token set` persists a token
- WHEN the file is written
- THEN `$XDG_CONFIG_HOME/hiberus/magento-cloud.json` is created at mode
  `0600`

### Requirement: Auth Status Never Echoes the Token

`auth status` MUST report the wrapped CLI's authentication state (wrapping
`auth:info --no-auto-login`) and MUST NOT print the token value in any
output stream under any outcome.

#### Scenario: Status output contains no token value

- GIVEN a resolvable token
- WHEN `hiberus-magento-cloud auth status` runs
- THEN its output reports the authentication state and never contains the
  token value

### Requirement: Raw environment:relationships Output Is CLI-Only

The CLI MUST expose the unstripped `environment:relationships` output
(including any username and password fields) as a CLI-only operation; this
raw form MUST NEVER be reachable from the MCP surface, where a human is not
necessarily present to view it.

#### Scenario: Raw relationships output may include credentials

- GIVEN a synthetic relationships fixture carrying `username` and
  `password` fields
- WHEN `hiberus-magento-cloud`'s relationships command runs
- THEN the CLI's own output may include the credential fields, unstripped

### Requirement: CLI-Only Operations Excluded from MCP

`auth token set` and the raw `environment:relationships` output MUST exist
only as CLI operations; neither MAY have a corresponding MCP tool
registration.

#### Scenario: CLI-only command has no MCP tool

- GIVEN the list of CLI-only operations
- WHEN the MCP server's `tools/list` response is inspected
- THEN no tool corresponds to either operation on that list

### Requirement: Exit Codes Reflect Outcome

The CLI MUST exit `0` on success and a non-zero code on any failure,
including a rejected argument, a missing credential, a
not-installed/not-authenticated/unsupported-version classification, or a
`db:sql` guard rejection.

#### Scenario: Failure exits non-zero

- GIVEN a command that fails (e.g. a missing credential)
- WHEN the process exits
- THEN its exit code is non-zero
