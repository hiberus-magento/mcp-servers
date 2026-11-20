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
does not exceed a documented, CI-blocking threshold expressed as a RATIO
against a reference module measured on the same machine in the same run.

The threshold MUST NOT be an absolute number of milliseconds. CPU time is
immune to contention but not to core speed, so an absolute figure measures
the runner as much as the bundle. This is recorded, not predicted: the
figure derived below at 75 ms failed this repository's first CI run
(GitHub Actions, ubuntu-24.04) at a minimum of 105.7 ms on a bundle
byte-identical to the one that measured 28.2 ms on the measuring machine —
a 3.6x per-core gap, and no regression. Widening the number to fit that
runner would have restored the uselessness the wall-clock budget was
abandoned for. Dividing by a reference measured on the same machine
cancels the machine: both sides get slower together.

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

The statistic MUST be the MINIMUM of at least 7 samples on each side of the
ratio, not the median or p95. Every source of interference can only make a
sample slower, so the minimum is the least contaminated one — and it
removes the need for a warm-up discard, because a cold first sample never
wins. The two sides MUST be interleaved, so that a drift in machine
conditions partway through a run lands on both of them.

The reference module MUST be a real workload of a cost comparable to a
server bundle's, not a trivial or empty module. A reference that measured
only the fixed per-import overhead would leave all the machine-dependence
in the numerator and reinstate the defect this requirement exists to
remove. Its shape MUST be chosen by measurement against real bundles, and
the choice recorded with the alternatives it beat.

The threshold value MUST be recorded in this spec together with the
methodology that produced it: the sample count, the statistic, the
reference module's shape and size, the worst measured ratio it was derived
from, and the safety multiplier applied. It MUST be re-derived, not
silently adjusted, if the bundle's shape changes materially or if the
reference module's shape changes.

DISCLOSED LIMITATION, deliberately accepted: a CPU-time gate does not
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
catch a real regression.

It further supersedes the absolute CPU formulation
(`STARTUP_CPU_BUDGET_MS = 75`), which removed contention from the
measurement but not core speed, and failed the first CI run on an unchanged
bundle as recorded above. The ratio keeps that formulation's measurement
and its statistic unchanged; only the thing the measurement is compared to
has changed, from a constant to a second measurement.

#### Recorded threshold and its derivation

- **Threshold:** `MAX_STARTUP_CPU_RATIO = 2`
  (`packages/mcp-testing/src/conformance/cold-start.ts`).
- **Statistic:** minimum of 7 samples of `process.cpuUsage()` across
  `await import()` of the built entrypoint, divided by the minimum of 7
  interleaved samples of the same measurement on the reference module.
- **Reference module:** generated, 462,607 bytes, 2,500 small functions each
  closing over a compiled `RegExp`, all called and retained at top level —
  the parse-plus-initialisation shape a bundled server has. Chosen by
  measuring three candidate shapes against two real bundles under four
  execution regimes (default, `--no-opt`, `--jitless`,
  `--max-semi-space-size=1`); its ratio spread across those regimes was
  1.152x, against 1.339x for a declarations-and-Map shape and 1.267-1.392x
  for retained object descriptors. A parse-only module was rejected on
  measurement (8.4 ms per MB against 24.7 ms for a 1.06 MB real bundle:
  parse is about a third of a bundle's startup cost), and an empty module
  on the same grounds (0.53 ms, almost entirely fixed loader overhead).
- **Measured 2026-10-22**, four bundles x four execution regimes x two
  repetitions on a 12-core development machine: ratio 0.837-1.102 overall
  (0.837-0.968 default, 0.944-1.102 under `--max-semi-space-size=1`).
  Separately, across five repetitions while machine load drifted, the
  absolute figures moved 1.21x (reference) and 1.35x (subjects) while the
  ratio moved 1.17x.
- **Derivation:** the repository's existing formula applied to the worst
  figure the statistic ever produced — `ceil(1.102 * 1.75) = 1.929`,
  rounded up to the next 0.25, giving 2.00. That leaves 1.81x over the
  worst measured ratio and 2.07x over the worst default-regime one.
- **Sensitivity:** a subject must cost roughly 1.8-2.4x what today's bundles
  cost to fail. That is about 0.5-1 MB of added code that both parses and
  initialises, or any dependency doing real work at import time. Byte growth
  alone is far weaker — inert code costs 8.4 ms per MB, so about 4.6x the
  current bundle — which is a property of measuring startup CPU, not of the
  ratio; `scripts/compare-bundle-size.mjs` watches bytes.
- **Re-derive when:** the reference module's shape or size changes, or a
  real CI-runner ratio becomes available and falls outside 0.793-1.102.
- **Known gap in the derivation:** these figures come from a development
  machine, not the CI runner, as every threshold in this file has. The
  four-regime spread is the substitute evidence that the reference tracks
  the subject when execution conditions change, and it is a substitute. What
  is no longer a gap is the failure mode that actually fired: a runner with
  slower cores moves both sides of the division.
- **Per-package override:** a package whose startup legitimately builds more
  (tool input schemas, for example) may declare
  `describeConformance({ startupCpuRatio: { max, reason } })`. `max` is a
  multiple of 0.25 above 0 and at most `MAX_STARTUP_CPU_RATIO_OVERRIDE = 4`;
  `reason` needs at least 20 characters and is printed in the test's title.
  A figure follows the same formula on the package's own worst measured
  ratio. Measured 2026-11-20 on a development machine, 3 x 7 samples:
  six-to-nine-tool servers 0.81-0.98; `magento-rest` (95 schemas) 1.19-1.25,
  so `ceil(1.25 * 1.75)` -> 2.25; `magento-graphql` (247 schemas) 2.02-2.11,
  so `ceil(2.11 * 1.75)` -> 3.75. These replace the per-package millisecond
  budgets (100 ms and 150 ms) the absolute formulation carried.

#### Scenario: Startup cost within budget passes

- GIVEN a built server entrypoint whose minimum sampled startup CPU time is
  at or under the documented multiple of the reference module's
- WHEN the suite imports both and samples `process.cpuUsage()` across each
  import
- THEN the startup-cost assertion passes

#### Scenario: Startup cost exceeding budget fails

- GIVEN a built server entrypoint whose minimum sampled startup CPU time
  exceeds the documented multiple of the reference module's
- WHEN the suite imports both and samples `process.cpuUsage()` across each
  import
- THEN the assertion fails and reports the ratio, both minima, and every
  sample's CPU and wall-clock figure on both sides

#### Scenario: A subject burning CPU at import time is caught

- GIVEN a module that performs real work at module top level, the shape a
  startup regression takes
- WHEN the suite measures it through the same harness
- THEN the assertion fails, proving the gate discriminates rather than
  merely passing

#### Scenario: The reference module is a workload, not a stub

- GIVEN the generated reference module the ratio divides by
- WHEN its startup CPU is measured against an empty module's in the same run
- THEN it costs at least an order of magnitude more, proving the denominator
  carries its share of the machine-dependence rather than leaving it all in
  the numerator

#### Scenario: Threshold is recorded with its derivation methodology

- GIVEN the startup-cost threshold value committed to this spec
- WHEN it is reviewed
- THEN the sample count, the statistic, the reference module's shape and
  size, the worst measured ratio, and the safety-margin multiplier used to
  derive the threshold are recorded alongside it, not only a bare number
