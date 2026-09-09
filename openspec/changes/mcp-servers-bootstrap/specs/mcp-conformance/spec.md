# MCP Conformance Specification

## Purpose

Defines the CI-blocking conformance suite in `@hiberus-magento/mcp-testing` that every server package must pass, and the shared synthetic `catalog-views.csv` fixture used across domain packages.

## Requirements

### Requirement: tools/list Responds Correctly

The conformance suite MUST assert that a server under test responds to a `tools/list` JSON-RPC request with a well-formed tool list.

#### Scenario: Server answers tools/list

- GIVEN a running server under test
- WHEN the suite sends a `tools/list` request
- THEN it receives a valid JSON-RPC response listing the server's tools

### Requirement: Stdout Purity Assertion

The conformance suite MUST assert that nothing but JSON-RPC messages ever reaches the server's stdout stream during the full test session.

#### Scenario: Clean session passes

- GIVEN a server under test that never writes non-protocol data to stdout
- WHEN the suite runs a full interaction session
- THEN the stdout-purity assertion passes

#### Scenario: Stray stdout output fails the suite

- GIVEN a server under test that writes one stray non-JSON-RPC line to stdout
- WHEN the suite runs
- THEN the stdout-purity assertion fails and identifies the offending line

### Requirement: Tool Metadata Completeness

For every tool a server exposes, the suite MUST assert a non-empty description, a valid input schema, and all three MCP annotations are present.

#### Scenario: Complete tool metadata passes

- GIVEN every tool has a description, schema, and all three annotations
- WHEN the suite runs
- THEN the metadata-completeness assertion passes

#### Scenario: Missing annotation fails the suite

- GIVEN a tool missing `idempotentHint`
- WHEN the suite runs
- THEN it fails and names the offending tool and missing annotation

### Requirement: Read-Only Tool Isolation

For every tool annotated `readOnlyHint: true`, the suite MUST assert it never invokes any command outside a declared read-only allowlist.

#### Scenario: Read-only tool stays within the allowlist

- GIVEN a tool annotated `readOnlyHint: true` that only calls allowlisted read commands
- WHEN the suite exercises it
- THEN the assertion passes

#### Scenario: Read-only tool escaping its allowlist fails

- GIVEN a tool annotated `readOnlyHint: true` that attempts a command outside the read allowlist
- WHEN the suite exercises it
- THEN the assertion fails and identifies the disallowed command

### Requirement: Published Tarball Shape

The suite MUST assert that the packed tarball for a server package declares `dependencies: {}`, preserves the executable shebang on its entrypoint, and includes a `LICENSE` file.

#### Scenario: Conformant tarball passes

- GIVEN a package packed with `npm pack`
- WHEN the suite inspects the tarball
- THEN `package.json` inside it declares `dependencies: {}`, the entrypoint's first line is a shebang, and `LICENSE` is present

#### Scenario: Missing LICENSE fails the suite

- GIVEN a packed tarball with no `LICENSE` file
- WHEN the suite inspects it
- THEN the assertion fails

### Requirement: Bundle Size and Forbidden Dependency Gate

The suite MUST assert the bundled server entrypoint is a single file no larger than 2 MB and contains zero occurrences of the literal strings `express`, `hono`, `cors`, `jose`, and `ajv`.

#### Scenario: Lean bundle passes the gate

- GIVEN a bundled entrypoint under 2 MB with none of the forbidden strings present
- WHEN the gate runs
- THEN it passes

#### Scenario: Oversized or contaminated bundle fails the gate

- GIVEN a bundled entrypoint exceeding 2 MB, or containing the string `express`
- WHEN the gate runs
- THEN it fails and reports which condition was violated

### Requirement: Shared Synthetic Catalog-Views Fixture

The suite MUST own a shared `catalog-views.csv` fixture, populated exclusively with synthetic vertical, store-view, and locale values, for use as a cross-domain integration fixture.

#### Scenario: Fixture contains no real identifiers

- GIVEN the committed `catalog-views.csv`
- WHEN its contents are inspected
- THEN every row uses synthetic organization, site, and domain values, and no real customer identifier appears

#### Scenario: Fixture is consumable by multiple domain packages

- GIVEN two domain packages that both need catalog-view test data
- WHEN each imports the shared fixture from `mcp-testing`
- THEN neither package maintains its own duplicate copy
