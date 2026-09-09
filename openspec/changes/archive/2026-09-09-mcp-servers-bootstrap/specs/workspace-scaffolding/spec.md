# Workspace Scaffolding Specification

## Purpose

Defines the pnpm/turbo/TypeScript workspace foundation, build graph, and quality-gate lint rules that every package in this monorepo builds on.

## Requirements

### Requirement: Pinned Toolchain

The workspace MUST pin Node.js to `>=22` in `engines.node` of the root `package.json`, and MUST pin the package manager version via `packageManager` for corepack.

#### Scenario: Clean install on Node 22

- GIVEN a clean clone of the repository
- WHEN `corepack enable && pnpm install` runs on Node 22
- THEN pnpm resolves to the exact pinned version and installation succeeds

#### Scenario: Reject unpinned pnpm

- GIVEN corepack is enabled
- WHEN a pnpm command runs without the pinned version available
- THEN corepack fetches/enforces the pinned version rather than silently using an ambient one

### Requirement: pnpm Workspace and Turbo Build Graph

The repository MUST declare a `pnpm-workspace.yaml` covering `packages/*`, and a `turbo.json` defining `build`, `lint`, `typecheck`, and `test` pipeline tasks with correct `dependsOn` ordering.

#### Scenario: Root build orchestrates all packages

- GIVEN two or more packages under `packages/*`
- WHEN `pnpm build` runs at the repo root
- THEN turbo builds every package, respecting inter-package `dependsOn` order, and fails the run if any package build fails

### Requirement: Shared TypeScript Configuration

A shared root `tsconfig.base.json` MUST exist and every package's `tsconfig.json` MUST extend it, targeting ESM-only (`"type": "module"`) output.

#### Scenario: Package inherits shared compiler options

- GIVEN a package's `tsconfig.json` extends the root base config
- WHEN `pnpm typecheck` runs
- THEN the package is checked under the shared strict compiler options without redeclaring them

### Requirement: Vitest Wired Through Turbo

`pnpm test` at the repo root MUST invoke vitest for every package through the turbo `test` pipeline task.

#### Scenario: Root test command runs every package's suite

- GIVEN packages with vitest test files
- WHEN `pnpm test` runs at the repo root
- THEN turbo invokes each package's vitest suite and the root command fails if any package's tests fail

### Requirement: Client-Boundary Import Rule

The eslint flat config MUST configure `no-restricted-imports` so that code outside a package's own `client/` directory MUST NOT import any path under another package's `client/` deeper than `client/index.ts`.

#### Scenario: Deep client import is rejected

- GIVEN a source file importing `@hiberus-magento/mcp-core/client/internal-helper`
- WHEN eslint runs
- THEN eslint reports a `no-restricted-imports` violation and the lint task fails

#### Scenario: Public client entrypoint import is allowed

- GIVEN a source file importing `@hiberus-magento/mcp-core/client/index`
- WHEN eslint runs
- THEN no boundary violation is reported

### Requirement: License-Header Lint Rule

The eslint flat config MUST enforce a license-header rule requiring the Apache-2.0 header comment at the top of every source file.

#### Scenario: Missing header fails lint

- GIVEN a new `.ts` source file with no license header
- WHEN eslint runs
- THEN eslint reports a license-header violation and the lint task fails

#### Scenario: Correct header passes lint

- GIVEN a source file starting with the required Apache-2.0 header comment
- WHEN eslint runs
- THEN no license-header violation is reported
