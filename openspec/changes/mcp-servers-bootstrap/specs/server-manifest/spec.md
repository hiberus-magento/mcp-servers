# Server Manifest Specification

## Purpose

Defines `servers.json` as the single source of truth for the set of published MCP servers, its JSON Schema, the generated README, and the `pnpm new-server` scaffolding generator.

## Requirements

### Requirement: servers.json as Single Source of Truth

`servers.json` at the repo root MUST list every published server package with at minimum its package name, description, and status, and MUST validate against `schema/servers.schema.json`.

#### Scenario: Valid manifest passes schema validation

- GIVEN a `servers.json` listing one entry with all required fields
- WHEN validated against `schema/servers.schema.json`
- THEN validation succeeds

#### Scenario: Invalid manifest fails schema validation

- GIVEN a `servers.json` entry missing the required `description` field
- WHEN validated against the schema
- THEN validation fails and names the missing field

### Requirement: Generated README, No Hand Edits

`README.md` MUST be generated from `servers.json` by a script, and CI MUST fail if the committed `README.md` differs from freshly regenerated output.

#### Scenario: README regeneration matches committed file

- GIVEN `servers.json` and the committed `README.md` are in sync
- WHEN the README generator runs and its output is diffed against the committed file
- THEN there is no difference and CI passes

#### Scenario: Stale README blocks CI

- GIVEN `servers.json` was edited but `README.md` was not regenerated
- WHEN CI runs the README-freshness check
- THEN CI fails, identifying the README as stale

### Requirement: Server Template Scaffold

`templates/server/` MUST contain a minimal, working MCP server package skeleton (package.json, tsconfig, entrypoint, a template test) that already satisfies the conformance suite.

#### Scenario: Template alone passes conformance

- GIVEN only `templates/server/` copied into a new package directory with its placeholders filled
- WHEN the conformance suite runs against it
- THEN it passes without further modification

### Requirement: pnpm new-server Generator

Running `pnpm new-server <name>` MUST create a new package under `packages/<name>` from `templates/server/`, register it in `servers.json`, and regenerate `README.md`.

#### Scenario: Generator produces a conformant package

- GIVEN `pnpm new-server example-domain` is run with a synthetic package name
- WHEN the command completes
- THEN `packages/example-domain` exists, `servers.json` includes an entry for it, `README.md` is regenerated, and the conformance suite passes against the new package unmodified

#### Scenario: Generator rejects a name collision

- GIVEN a package already exists at `packages/example-domain`
- WHEN `pnpm new-server example-domain` is run again
- THEN the generator fails without overwriting the existing package
