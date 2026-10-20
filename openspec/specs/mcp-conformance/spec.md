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

The conformance suite MUST assert that nothing but JSON-RPC messages ever
reaches the server's stdout stream during the full test session. The suite
MUST own a domain-independent fd-1 contamination probe: a child process
that writes directly to file descriptor 1, independent of any tool the
package under test defines, so that a package with no `execFile`-based
tool is still exercised for stdout purity. Supplying a `shellOutProbe` to
the suite MUST be OPTIONAL. When a package under test supplies no
`shellOutProbe`, the domain-independent probe alone MUST still be
sufficient to fail the suite on stdout contamination. When a package under
test DOES supply a `shellOutProbe`, the suite MUST run the existing
exec-based contamination assertion exactly as it did before this change,
unweakened.

(Previously: the probe assumed every package under test supplied an
`execFile`-based `shellOutProbe`-shaped tool as the sole
contamination-detection mechanism, so a pure-HTTPS package had to ship a
decorative exec tool purely to satisfy the harness.)

#### Scenario: Clean session passes

- GIVEN a server under test that never writes non-protocol data to stdout
- WHEN the suite runs a full interaction session
- THEN the stdout-purity assertion passes

#### Scenario: Stray stdout output fails the suite

- GIVEN a server under test that writes one stray non-JSON-RPC line to
  stdout
- WHEN the suite runs
- THEN the stdout-purity assertion fails and identifies the offending line

#### Scenario: Domain-independent probe catches contamination with no shellOutProbe supplied

- GIVEN a server under test that supplies no `shellOutProbe` and has no
  `execFile`-based tool
- WHEN the suite's domain-independent fd-1 probe runs a contaminating
  child process against the server's stdio stream
- THEN the stdout-purity assertion still fails on the contamination,
  proving the probe does not depend on a domain tool

#### Scenario: Supplying shellOutProbe preserves exec-based coverage unweakened

- GIVEN a server under test that supplies a `shellOutProbe` wrapping an
  `execFile`-based tool whose child process contaminates fd 1
- WHEN the suite runs the existing exec-based contamination assertion
- THEN it fails exactly as it did before this change, proving the new
  domain-independent probe is additive coverage, not a replacement
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

The suite MUST own a shared `catalog-views.csv` fixture, populated
exclusively with synthetic vertical, store-view, and locale values, for
use as a cross-domain integration fixture. The fixture's header MUST be
`vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency`. The
`ac_view_id`, `ac_price_book_id`, and `currency` columns MUST be additive:
no existing column (`vertical`, `site`, `locale`, `view_code`) MAY be
renamed, reordered ahead of its original position, or dropped, so every
existing consumer keeps working unmodified against the migrated fixture.

(Previously: header was `vertical,site,locale,view_code`, with no
ACO-provisioned columns; the fixture could not carry the `aco`→`eds`
hand-off.)

#### Scenario: Fixture contains no real identifiers

- GIVEN the committed `catalog-views.csv`
- WHEN its contents are inspected
- THEN every row uses synthetic organization, site, and domain values, and
  no real customer identifier appears

#### Scenario: Fixture is consumable by multiple domain packages

- GIVEN two domain packages that both need catalog-view test data
- WHEN each imports the shared fixture from `mcp-testing`
- THEN neither package maintains its own duplicate copy

#### Scenario: Migration is additive and existing consumers keep working

- GIVEN the migrated fixture and `eds`'s existing test suite, which reads
  only `vertical`, `site`, `locale`, and `view_code`
- WHEN `eds`'s suite runs against the migrated fixture
- THEN it passes unmodified, proving no existing column was renamed or
  removed

#### Scenario: Fixture carries the ACO-to-EDS hand-off columns

- GIVEN the migrated `catalog-views.csv`
- WHEN its header row is parsed
- THEN it contains `ac_view_id`, `ac_price_book_id`, and `currency` in
  addition to the four original columns

#### Scenario: A provisioned row is the same row both domains read

- GIVEN a fixture-fed `aco`-side function that writes an `ac_view_id` for
  a synthetic `(vertical, site)` pair
- WHEN the `eds`-side config path reads `catalog-views.csv` for that same
  `(vertical, site)` pair
- THEN it reads the exact `ac_view_id` value the `aco`-side function wrote,
  proving one shared row rather than two independently-parsed copies


### Requirement: Cold-Start Startup-Cost Budget

The conformance suite MUST assert that a server's own startup cost — the
CPU time the process spends loading and initialising the built entrypoint,
measured with `process.cpuUsage()` across `await import()` of that bundle —
does not exceed a documented, CI-blocking threshold.

The measurement is CPU time, not wall-clock time, and this is load-bearing.
Wall clock counts the time a process spends descheduled, so on a shared CI
runner it measures the runner's contention rather than the bundle. Measured
on 2026-10-20 across all three server bundles: under CPU oversubscription
the wall-clock figure moved more than 20x (25-27 ms idle to 379-592 ms
contended) while the CPU figure moved 1.3x (28-30 ms to 31-39 ms), with
nothing about the bundles changed. A ratio against a cheap baseline does
not rescue wall clock either: the two sides are not duration-matched, so
the heavier side accumulates more preemption and the ratio inflates under
load rather than cancelling.

The statistic MUST be the MINIMUM of at least 7 samples, not the median or
p95. Every source of interference can only make a sample slower, so the
minimum is the least contaminated one — and it removes the need for a
warm-up discard, because a cold first sample never wins.

The threshold value MUST be recorded in this spec together with the
methodology that produced it: the sample count, the statistic, the worst
measured figure it was derived from, and the safety multiplier applied. It
MUST be re-derived, not silently adjusted, if the bundle's shape changes
materially or if the runner's per-core speed changes by more than the
headroom the recorded derivation leaves.

DISCLOSED LIMITATION, deliberately accepted: a CPU-time budget does not
fire for a server that is slow for a reason costing no CPU — a sleep, or a
network call at startup. A wall-clock measurement of the same subject is
retained as a non-blocking diagnostic, and the gap is pinned by a test
asserting that the CPU gate does NOT fire for a sleep-based subject, so the
limitation cannot quietly become untrue. Such a server is still caught by
the suite's own setup, which awaits a real `initialize` response.

This requirement supersedes the previous wall-clock formulation, which
timed from `spawn()` to the `initialize` response against a threshold
derived from at least 15 cold spawns on the CI runner. That formulation was
abandoned for two reasons recorded here rather than silently: its "measured
on the actual CI runner" clause was never satisfied — the committed figure
came from a development machine, as its own disclosed limitation said — and
its rounding inflated an 82 ms measurement to a 250 ms threshold, leaving
5.9x of headroom, so it flaked under contention while being too loose to
catch a real regression. The replacement leaves 1.94x over its worst
contended measurement: it is more sensitive than what it replaces, not
less.

#### Recorded threshold and its derivation

- **Threshold:** `STARTUP_CPU_BUDGET_MS = 75`
  (`packages/mcp-testing/src/conformance/cold-start.ts`).
- **Statistic:** minimum of 7 samples of `process.cpuUsage()` across
  `await import()` of the built entrypoint.
- **Measured 2026-10-20**, across all three server bundles on a 12-core
  development machine: 28.2-29.9 ms idle, 30.8-38.6 ms under CPU
  oversubscription at load averages of 230-400.
- **Derivation:** the repository's existing formula applied to the worst
  figure the statistic ever produced — `ceil(38.6 * 1.75) = 68`, rounded up
  to the next 25 ms, giving 75. That leaves 2.6x over the idle measurement
  and 1.94x over the worst contended one.
- **Re-derive when:** the bundle's shape changes materially, or the runner's
  per-core speed is more than ~2.5x slower than the measuring machine, which
  is where an unchanged bundle would cross 75 ms.
- **Known gap in the derivation:** these figures come from a development
  machine, not the CI runner. CPU time is immune to contention but not to
  core speed, so the multiplier above is the margin that carries this across
  machines. The same gap existed in the superseded wall-clock figure and is
  inherited, not introduced.

#### Scenario: Startup cost within budget passes

- GIVEN a built server entrypoint whose minimum sampled startup CPU time is
  at or under the documented threshold
- WHEN the suite imports it and samples `process.cpuUsage()` across the
  import
- THEN the startup-cost assertion passes

#### Scenario: Startup cost exceeding budget fails

- GIVEN a built server entrypoint whose minimum sampled startup CPU time
  exceeds the documented threshold
- WHEN the suite imports it and samples `process.cpuUsage()` across the
  import
- THEN the assertion fails and reports every sample's CPU and wall-clock
  figure against the threshold

#### Scenario: A subject burning CPU at import time is caught

- GIVEN a module that performs real work at module top level, the shape a
  startup regression takes
- WHEN the suite measures it through the same harness
- THEN the assertion fails, proving the gate discriminates rather than
  merely passing

#### Scenario: Threshold is recorded with its derivation methodology

- GIVEN the cold-start threshold value committed to this spec
- WHEN it is reviewed
- THEN the number of CI-runner spawns, the computed p95, and the
  safety-margin multiplier used to derive the threshold are recorded
  alongside it, not only a bare number
