# Delta for mcp-conformance

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Cold-Start Time Budget

The conformance suite MUST assert that a server's cold-start time —
measured from `spawn()` of the built entrypoint to the `initialize`
response the suite's setup already performs — does not exceed a
documented, CI-blocking threshold. The threshold value MUST be recorded in
this spec together with the methodology that produced it: at least 15 cold
spawns (no warm pool) measured on the actual CI runner (not a local
development machine), with p95 computed from those measurements and a
documented safety margin applied on top of it. The threshold MUST be
re-derived, not silently adjusted, if the bundle's shape changes
materially.

#### Scenario: Cold start within budget passes

- GIVEN a built server entrypoint whose measured cold-start time is under
  the documented threshold
- WHEN the suite spawns it and times to the `initialize` response
- THEN the cold-start assertion passes

#### Scenario: Cold start exceeding budget fails

- GIVEN a built server entrypoint whose measured cold-start time exceeds
  the documented threshold
- WHEN the suite spawns it and times to the `initialize` response
- THEN the cold-start assertion fails and reports the measured time
  against the threshold

#### Scenario: Threshold is recorded with its derivation methodology

- GIVEN the cold-start threshold value committed to this spec
- WHEN it is reviewed
- THEN the number of CI-runner spawns, the computed p95, and the
  safety-margin multiplier used to derive the threshold are recorded
  alongside it, not only a bare number
