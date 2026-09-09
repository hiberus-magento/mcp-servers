# Release Pipeline Specification

## Purpose

Defines changesets-based independent versioning, the CI/release GitHub Actions workflows, license compliance, and secret-scanning gates for publishing packages under `@hiberus-magento` to public npm.

## Requirements

### Requirement: Changesets Independent Versioning

Changesets MUST be initialized for independent per-package versioning under the `@hiberus-magento` npm scope, with `access: public` and `provenance: true` in the publish configuration.

#### Scenario: Package config declares public provenance publish

- GIVEN a package's `package.json` and the changesets config
- WHEN inspected
- THEN `publishConfig.access` is `public`, `publishConfig.provenance` is `true`, and the package name is scoped `@hiberus-magento/*`

#### Scenario: Independent version bumps

- GIVEN two packages, only one of which has a merged changeset
- WHEN `changeset version` runs
- THEN only the package with a changeset receives a version bump

### Requirement: CI Workflow Blocks on Every Gate

`.github/workflows/ci.yml` MUST run, in order and on `ubuntu-latest`: install, lint, typecheck, test, build, the conformance suite, the license allowlist check, and secret scanning — and MUST fail the workflow if any step fails.

#### Scenario: A single failing gate blocks CI

- GIVEN a pull request that fails the license allowlist check but passes every other step
- WHEN `ci.yml` runs
- THEN the workflow run reports failure

#### Scenario: All gates green

- GIVEN a change that passes install, lint, typecheck, test, build, conformance, license allowlist, and secret scanning
- WHEN `ci.yml` runs
- THEN the workflow run reports success

### Requirement: License Allowlist Enforcement

CI MUST fail if any resolved production dependency license falls outside the allowlist `MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD`.

#### Scenario: Disallowed license blocks CI

- GIVEN a dependency declaring a `GPL-3.0` license
- WHEN the license allowlist check runs
- THEN the check fails and names the offending package and license

### Requirement: Release Workflow Uses OIDC Trusted Publishing

`.github/workflows/release.yml` MUST run `changeset publish` on `ubuntu-latest` with `permissions: id-token: write` and `contents: write`, and MUST prefer OIDC trusted publishing over a long-lived `NPM_TOKEN`.

#### Scenario: Release job requests OIDC token

- GIVEN the release workflow's permissions block
- WHEN inspected
- THEN `id-token: write` and `contents: write` are both present and no `NPM_TOKEN` secret is required for the default path

#### Scenario: Dry-run publish only

- GIVEN this change publishes no real versions
- WHEN the release workflow is exercised
- THEN it is verified via dry run and does not push a real version to the npm registry

### Requirement: Per-Package Third-Party Notices

Every publishable package MUST include a `THIRD-PARTY-NOTICES.txt` listing its resolved dependency licenses, and MUST reproduce the full NOTICE content of any bundled Apache-2.0 dependency that carries one.

#### Scenario: Notices file lists dependency licenses

- GIVEN a package with resolved MIT and Apache-2.0 dependencies
- WHEN its `THIRD-PARTY-NOTICES.txt` is generated
- THEN every dependency and its license appear, and any bundled Apache-2.0 dependency's own NOTICE text is included verbatim

#### Scenario: Missing notices file blocks CI

- GIVEN a publishable package with no `THIRD-PARTY-NOTICES.txt`
- WHEN CI runs
- THEN the build or license check fails

### Requirement: Secret Scanning

CI MUST run a secret-scanning step over the diff and fail the workflow if a credential-shaped string is detected.

#### Scenario: Committed token is caught

- GIVEN a commit introducing a string matching a known secret pattern (e.g. an API token format)
- WHEN the secret-scanning step runs
- THEN CI fails and reports the offending file and line
