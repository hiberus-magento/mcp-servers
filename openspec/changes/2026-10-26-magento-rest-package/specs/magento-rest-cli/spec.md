# Spec: magento-rest-cli

## Requirement: No Credential Argument
The CLI MUST NOT accept a token as an argument. `--token` and `--token=` MUST be rejected before any other action.

#### Scenario: token flag
- WHEN `auth token set --token=<value>` is run
- THEN the exit code MUST be 1, the message MUST point at stdin, and nothing MUST be stored

## Requirement: Token Storage
`auth token set` MUST read the token from stdin, MUST store it at mode `0600`, and MUST print the file path and never the token. An empty token MUST be refused.

## Requirement: Status
`auth status` MUST print an 8-hex-character SHA-256 fingerprint and the result of one authenticated read, and MUST NOT print the token under any outcome. A missing credential MUST be reported with the remedy; a rejected one MUST be reported by kind.

## Requirement: No Data Commands
The CLI MUST NOT read or write catalog data; the MCP tools are the only data surface.
