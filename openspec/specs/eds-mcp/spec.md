# EDS MCP Server Specification

## Purpose

Defines the `hiberus-eds-mcp` server (`packages/eds/src/mcp.ts`): its
nine-tool task-shaped surface, tool annotations, and the two hazard gates
that make destructive full-site and unscoped-bulk operations unreachable by
accident.

## Requirements

### Requirement: Nine-Tool Task-Shaped Surface

The server MUST expose exactly these nine tools and no others:
`eds_get_status`, `eds_get_status_bulk`, `eds_set_live_state`,
`eds_get_site_config`, `eds_reindex`, `eds_get_audit_log`,
`eds_get_snapshots`, `eds_manage_snapshot`, `eds_get_job_status`. Each
tool's description MUST state when to use it, not only what it does.

#### Scenario: tools/list matches the declared surface exactly

- GIVEN the running server
- WHEN `tools/list` is called
- THEN the response contains exactly these nine tool names, with no
  CLI-only operation among them

### Requirement: Annotations Match Declared Read/Destructive/Idempotent Semantics

Each tool's `readOnlyHint`, `destructiveHint`, and `idempotentHint` MUST
match its documented triple: `eds_get_status`, `eds_get_status_bulk`,
`eds_get_site_config`, `eds_get_audit_log`, `eds_get_snapshots`, and
`eds_get_job_status` are `true/false/true`; `eds_set_live_state` is
`false/true/true`; `eds_reindex` is `false/false/true`; and
`eds_manage_snapshot` is `false/true/false`.

#### Scenario: Mutating, non-idempotent tool is annotated correctly

- GIVEN `eds_manage_snapshot`'s registration
- WHEN its annotations are inspected
- THEN `readOnlyHint` is `false`, `destructiveHint` is `true`, and
  `idempotentHint` is `false`

### Requirement: Full-Site Reindex Requires Both Gate Fields

`eds_reindex` MUST accept a discriminated union:
`{ scope: "paths", paths: string[] }` or
`{ scope: "full-site", confirmFullReindex: true }`. The full-site branch
MUST be unreachable unless BOTH the literal discriminant
`scope: "full-site"` AND the literal `confirmFullReindex: true` are
present.

#### Scenario: scope alone does not trigger a full reindex

- GIVEN a call with `scope: "full-site"` and `confirmFullReindex` omitted
  or `false`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level and no reindex is
  triggered

#### Scenario: Both fields together reach the full-site branch

- GIVEN a call with `scope: "full-site"` and `confirmFullReindex: true`
- WHEN the tool validates the input
- THEN the full-site reindex branch executes

### Requirement: Bulk Write paths Is Non-Empty

Every tool accepting a `paths` array for a bulk write
(`eds_get_status_bulk`, `eds_set_live_state`, and `eds_reindex`'s paths
branch) MUST reject an omitted or empty `paths` array at the schema level.

#### Scenario: Empty paths array is a schema rejection

- GIVEN a call to `eds_set_live_state` with `paths: []`
- WHEN the tool validates the input
- THEN the call is rejected before any request is issued, never
  interpreted as "all paths"

### Requirement: Missing Credential Surfaces as an Immediate Actionable Failure

When any tool call cannot obtain a valid `eds` credential, the server MUST
return an error result immediately, naming the exact CLI command to run to
fix it, and MUST NOT hang or prompt for input.

#### Scenario: Missing token produces an actionable error, not a hang

- GIVEN no `EDS_TOKEN` and no persisted config file
- WHEN any tool is called
- THEN the response has `isError: true` with text naming
  `hiberus-eds auth token set` as the remedy, returned without delay
