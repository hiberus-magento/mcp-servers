# AEM Sites CLI Specification

## Purpose

Defines `hiberus-aem-sites` (`packages/aem-sites/src/cli.ts`), the operator CLI: per-environment
token storage, the auth probe, page listing, and plan / apply of the same operations the MCP server
offers. It never writes to the author without `--yes`.

## Requirements

### Requirement: Token From stdin Only, per Environment

`auth token set --env <env>` MUST read the token from stdin only (no flag or positional argument
can carry it), accept the raw token, a `Bearer `-prefixed one or the Developer Console JSON
(`accessToken`), and store it at mode `0600` as `aem-sites-<env>.json`. `auth token clear --env`
MUST simulate without `--yes`.

#### Scenario: A token passed as an argument

- GIVEN `auth token set --env stage --token x`
- WHEN the CLI runs
- THEN it exits 1 and nothing is stored

### Requirement: Nothing Writes Without --yes

`plan` MUST print the plan and never write; `apply` without `--yes` MUST print the plan and say it
is a simulation; `apply --yes` MUST plan and apply in one process with the same checks as
`aem_apply`, passing `--confirm-target` for protected targets.

#### Scenario: apply without --yes

- GIVEN a valid operation file
- WHEN `apply --env stage --operation op.json` runs
- THEN the plan is printed and no POST reaches the author

### Requirement: Auth Status Probe

`auth status [--env]` MUST report, per environment, the author origin, where the token comes from
(never the token) and the QueryBuilder probe verdict, exiting 1 if any environment fails.

#### Scenario: Expired token

- GIVEN an environment whose token the author answers with 401
- WHEN `auth status` runs
- THEN that environment shows `token-expired-or-invalid` with the renew command, and the exit code is 1
