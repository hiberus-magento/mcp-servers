# Magento Cloud MCP Server Specification

## Purpose

Defines the `hiberus-magento-cloud-mcp` server (`packages/magento-cloud/src/mcp.ts`):
its nine-tool task-shaped surface, tool annotations, the never-optional
`db:sql` query argument, the credential-stripped `serviceEndpoints` result
shape, actionable failure surfacing for a missing credential or a
classified CLI failure, and this package's first real exercise of the
shared conformance suite's exec-path options (`shellOutProbe`,
`readOnlyIntrospections`).

## Requirements

### Requirement: Nine-Tool Read-Only Surface, No Others

The server MUST expose exactly these nine tools and no others:
`magentocloud_auth_status`, `magentocloud_list_projects`,
`magentocloud_describe_project`, `magentocloud_list_environments`,
`magentocloud_describe_environment`, `magentocloud_get_environment_config`,
`magentocloud_get_activities`, `magentocloud_get_activity_log`,
`magentocloud_query_database`. Every tool
MUST be annotated `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, and each description MUST state when to use it.

`magentocloud_get_activity_log` MUST require `activityId`; it MUST NOT
default to the most recent activity, which would need a second lookup and
would leave the caller unable to tell which activity was read.

#### Scenario: tools/list matches the declared surface exactly

- GIVEN the running server
- WHEN `tools/list` is called
- THEN the response contains exactly these nine tool names, with no tool
  for any mutating operation

#### Scenario: Every tool is annotated read-only, non-destructive, idempotent

- GIVEN each of the nine tools' registrations
- WHEN their annotations are inspected
- THEN each is `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`

### Requirement: magentocloud_query_database Uses a Discriminated Request Shape

`magentocloud_query_database`'s `request` argument MUST be a discriminated
union of `{ kind: "size" }` and
`{ kind: "select", query, maxRows? }`; no boolean `includeSize` flag and no
free-form mode string MAY exist anywhere in the schema.

#### Scenario: kind "size" wraps db:size

- GIVEN a call with `request: { kind: "size" }`
- WHEN the tool executes
- THEN it wraps `db:size` and issues no `db:sql` invocation

#### Scenario: An undiscriminated mode value does not type-check

- GIVEN the tool's zod input schema
- WHEN a type-level test attempts a call site with a free-form `mode`
  string instead of the `kind` discriminant
- THEN the call site fails to compile

### Requirement: select Branch query Argument Is Mandatory

The `{ kind: "select" }` branch's `query` field MUST be required in the
zod schema; no schema path MAY construct a select request with `query`
omitted, even though the underlying CLI's `query` argument is optional and
omitting it at the CLI level opens a hanging interactive SQL console.

#### Scenario: Omitted query is rejected, at both compile time and runtime

- GIVEN a call with `request: { kind: "select" }` and no `query` field
- WHEN the tool validates the input
- THEN the call is rejected before any process is spawned, proven by a
  type-level test asserting the call site is ill-typed and by a runtime
  rejection test

### Requirement: get_environment_config Never Returns Credential-Shaped serviceEndpoints Fields

When `include` contains `"serviceEndpoints"`, the tool result MUST contain
only `host`, `port`, `scheme`, and `service` per entry, and MUST NOT
contain a username- or password-shaped field, even when the underlying raw
relationships payload carries both.

#### Scenario: Tool result strips credentials from a credential-carrying fixture

- GIVEN a synthetic raw relationships fixture whose service entry carries
  `username` and `password`
- WHEN `magentocloud_get_environment_config` is called with
  `include: ["serviceEndpoints"]`
- THEN the tool result contains no username- or password-shaped field

### Requirement: Missing Credential Surfaces as Immediate Actionable Failure

When any tool call cannot resolve `MAGENTO_CLOUD_CLI_TOKEN`, the server
MUST return an error result immediately, with `isError: true`, naming
`hiberus-magento-cloud auth token set` as the remedy, and MUST NOT hang or
prompt for input.

#### Scenario: Missing token produces an actionable error, not a hang

- GIVEN no `MAGENTO_CLOUD_CLI_TOKEN` and no persisted config file
- WHEN any tool is called
- THEN the response has `isError: true` with text naming
  `hiberus-magento-cloud auth token set`, returned without delay

### Requirement: CLI-Failure Classification Surfaces as Distinct Actionable Tool Errors

A `not-installed`, `not-authenticated`, or `unsupported-version`
classification from the client MUST surface as a distinct `isError: true`
tool result naming its own remedy; none MAY be collapsed into a generic
failure message.

#### Scenario: Each classification produces a distinguishable tool-result message

- GIVEN each of the three CLI-failure classifications in turn
- WHEN the corresponding tool call surfaces the result
- THEN the three tool-result messages are pairwise distinguishable, each
  naming its own remedy

### Requirement: shellOutProbe Passes Against a Real execFile-Based Tool

`describeConformance`'s `shellOutProbe` option MUST pass when supplied one
of this server's real `execFile`-based read-only tools, proving fd-1
isolation for a genuine child process rather than only a synthetic
fixture.

#### Scenario: Conformance shellOutProbe passes against a real tool

- GIVEN `describeConformance` configured with a `shellOutProbe` targeting
  a real tool of this server
- WHEN the conformance suite runs
- THEN the probe passes

### Requirement: readOnlyIntrospections Passes Against the Real Registered Allowlist

`describeConformance`'s `readOnlyIntrospections` option MUST pass when fed
this server's real `CommandAllowlist.listCommandKeys()` output for a
read-only-hinted tool.

#### Scenario: Conformance readOnlyIntrospections passes against real listCommandKeys() output

- GIVEN `describeConformance` configured with `readOnlyIntrospections`
  sourced from this server's real `listCommandKeys()`
- WHEN the conformance suite runs
- THEN the introspection check passes
