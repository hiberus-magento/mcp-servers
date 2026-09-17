# Magento Cloud Client Specification

## Purpose

Defines `packages/magento-cloud/src/client/`, the domain client wrapping the
real `magento-cloud` CLI: the read-only subcommand allowlist, its argv
builders, the TSV response parser, the `db:sql` hardening guard, explicit
child-environment assembly, CLI-failure classification, and the module's
purity constraints. `client/index.ts` is its only public surface. Examples
below use synthetic identifiers only (e.g. `acme-demo-project`,
`acme-demo-env-main`); no real project id, environment name, or hostname
appears anywhere in this document.

## Requirements

### Requirement: Client Module Purity

The `client/` module MUST NOT call any `console.*` method, MUST NOT call
`process.exit`, MUST NOT prompt for input, MUST NOT emit ANSI color codes,
and MUST NOT read `process.env` directly; every configuration value MUST be
injected by the caller. Every client function MUST return a plain object,
never a string formatted for a human reader.

#### Scenario: No forbidden calls in client source

- GIVEN the `client/` source tree
- WHEN a static scan checks for `console.`, `process.exit`, `process.env`,
  prompt libraries, and ANSI escape sequences
- THEN none are found

#### Scenario: Client function returns structured data

- GIVEN a client call that succeeds
- WHEN its result is inspected
- THEN it is a plain object describing the outcome, not a pre-formatted
  display string

### Requirement: Client Boundary Import

Adapters (`cli.ts`, `mcp.ts`) MUST import only `client/index.ts`; importing
any other path inside `client/` MUST fail lint.

#### Scenario: Deep import is rejected by lint

- GIVEN an adapter file importing a `client/` path other than `index.ts`
- WHEN eslint's `no-restricted-imports` boundary rule runs
- THEN the deep import is reported as a lint error

### Requirement: Read-Only Allowlist Excludes Every Mutating and Passthrough Subcommand

The client's registered `CommandAllowlist` MUST contain exactly the
permitted read-only subcommands (`auth:info`, `project:list`,
`project:info`, `environment:list`, `environment:info`, `environment:url`,
`environment:relationships`, `activity:list`, `activity:log`,
`activity:get`, `variable:list`, `variable:get`, `route:list`,
`service:list`, `app:config-get`, `db:size`, `db:sql`, `subscription:info`)
and MUST NEVER register `ssh`, `environment:ssh`, `environment:scp`,
`environment:drush`, any of `tunnel:list`/`tunnel:open`/`tunnel:close`/
`tunnel:info`/`tunnel:single`, `db:dump`, any `snapshot:*` form, any
`mount:*` form, any `local:*` form, any `server:*` form, any `self:*` form,
`operation:run`, `console`, any mutating `environment:*`/`user:*`/
`team:*`/`organization:*`/`integration:*`/`resources:*` subcommand, or the
CLI's own generic REST passthroughs `api:curl`, `project:curl`,
`organization:curl`, and `environment:curl` — an arbitrary REST passthrough
is the same unconstrained shape `mcp-core`'s forbidden-token check bans a
raw `ssh` tool for.

#### Scenario: Registered command keys match the declared allowlist exactly

- GIVEN the client's `CommandAllowlist` after registration
- WHEN `listCommandKeys()` is inspected
- THEN it contains exactly the declared read-only subcommand set and none
  of the forbidden ones

#### Scenario: Generic REST passthrough is never registered

- GIVEN the forbidden set including `api:curl`, `project:curl`,
  `organization:curl`, and `environment:curl`
- WHEN the registered command keys are inspected
- THEN none of the four passthrough subcommands is present

### Requirement: Structured Reads Use TSV Output

Every list-shaped or table-shaped subcommand invocation MUST pass
`--format=tsv`; the client MUST NOT invoke any subcommand with
`--format=table`, `--format=csv`, `--format=plain`, or no `--format` at all
for a structured read.

#### Scenario: Argv always carries --format=tsv for list-shaped reads

- GIVEN any argv builder for a list- or table-shaped subcommand (e.g.
  `project:list`, `environment:list`, `variable:list`)
- WHEN the built argv is inspected
- THEN it contains `--format=tsv`

### Requirement: Quoted-Field TSV Parsing

The TSV response parser MUST treat the CLI's TSV output as CSV-formatted
with a tab delimiter, correctly handling a quoted field containing an
embedded tab or an embedded newline, rather than naive tab-splitting.

#### Scenario: Embedded tab inside a quoted field does not split the row

- GIVEN a TSV row whose one field is quoted and contains an embedded tab
  character
- WHEN the parser processes the row
- THEN that field is returned as one value and the row has the expected
  column count

#### Scenario: Embedded newline inside a quoted field does not split the row

- GIVEN a TSV row whose one field is quoted and contains an embedded
  newline character
- WHEN the parser processes it
- THEN that field is returned as one value spanning the newline, and no
  extra row is produced

### Requirement: db:sql Statement Shape Restriction

The `db:sql` guard MUST accept only a single statement whose leading verb
is `SELECT`, `SHOW`, `DESCRIBE`, `DESC`, or `EXPLAIN`, and MUST reject a
query containing any additional top-level `;`-separated statement, before
any process is spawned.

#### Scenario: Single SELECT statement is accepted

- GIVEN query `SELECT id FROM catalog_product_entity WHERE sku =
  'acme-demo-sku' LIMIT 10`
- WHEN the guard validates it
- THEN the query is accepted and forwarded toward argv construction

#### Scenario: A mutating leading verb is rejected

- GIVEN a query beginning with `UPDATE`, `DELETE`, `INSERT`, or `DROP`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

#### Scenario: A second statement after a semicolon is rejected

- GIVEN a query containing two `;`-separated statements, the first a valid
  `SELECT`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

### Requirement: db:sql SELECT * Rejection

The guard MUST reject `SELECT *` and `SELECT DISTINCT *` before any process
is spawned.

#### Scenario: SELECT * is rejected

- GIVEN query `SELECT * FROM catalog_product_entity`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

#### Scenario: SELECT DISTINCT * is rejected

- GIVEN query `SELECT DISTINCT * FROM catalog_product_entity`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

### Requirement: db:sql File-Exfiltration Forms Rejected

The guard MUST reject a query containing `INTO OUTFILE`, `INTO DUMPFILE`,
or `LOAD_FILE(`, each rejected independently, before any process is
spawned.

#### Scenario: INTO OUTFILE is rejected

- GIVEN a `SELECT` query containing `INTO OUTFILE`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

#### Scenario: INTO DUMPFILE is rejected

- GIVEN a `SELECT` query containing `INTO DUMPFILE`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

#### Scenario: LOAD_FILE( is rejected

- GIVEN a `SELECT` query containing `LOAD_FILE(`
- WHEN the guard validates it
- THEN it is rejected and `execFile` is never called

### Requirement: db:sql Mandatory LIMIT Injection and Row-Cap Enforcement

For a `SELECT` statement only, the guard MUST append an injected
`LIMIT <rowCap>` clause to a query carrying no trailing `LIMIT` before it
reaches `buildArgv`, and MUST reject — never clamp — a query whose explicit
trailing `LIMIT` exceeds the configured row cap, naming the cap in the
rejection message.

#### Scenario: Absent LIMIT is injected

- GIVEN a `SELECT` query with no trailing `LIMIT`
- WHEN the guard processes it
- THEN the argv passed toward `execFile` contains the query text with an
  injected `LIMIT <rowCap>` clause

#### Scenario: LIMIT above the cap is rejected, not clamped

- GIVEN a `SELECT` query with an explicit `LIMIT` above the configured row
  cap
- WHEN the guard validates it
- THEN it is rejected, `execFile` is never called, and the rejection
  message states the cap

### Requirement: maxOutputBytes Is an Independent Second Cap

`db:sql` MUST enforce `maxOutputBytes` independently of the injected
`LIMIT`; the byte cap MUST be reachable even when the row cap has not been
exceeded, and neither cap substitutes for the other.

#### Scenario: Output-cap enforcement is independent of the row cap

- GIVEN a query whose row count is within the injected `LIMIT` but whose
  rows exceed `maxOutputBytes` cumulatively
- WHEN the client executes the query
- THEN execution is bounded by `maxOutputBytes` and the result is
  classified as an output-cap outcome, not a row-cap outcome

### Requirement: Explicit Child Environment Assembly

The client MUST assemble the child environment for every spawned
`magento-cloud` invocation as exactly the named variables
`MAGENTO_CLOUD_CLI_TOKEN`, `HOME`, and `PATH`, with the token resolved via
`mcp-core`'s `resolveCredentialValue`/`MissingCredentialError`, and MUST
NEVER include any other variable.

#### Scenario: Child env contains exactly the named variables

- GIVEN a resolved token and the parent process's `HOME`/`PATH`
- WHEN the client spawns `magento-cloud`
- THEN the captured child environment's key set is exactly
  `{MAGENTO_CLOUD_CLI_TOKEN, HOME, PATH}` and nothing else

#### Scenario: Missing token fails before any process is spawned

- GIVEN no resolvable `MAGENTO_CLOUD_CLI_TOKEN` via environment variable or
  config file
- WHEN the client attempts any operation
- THEN it throws `MissingCredentialError` naming the variable, and
  `execFile` is never called

### Requirement: CLI-Failure Classification Names an Actionable Remedy

The client MUST classify a spawn failure into exactly one of
`not-installed` (`ENOENT`), `not-authenticated`, or `unsupported-version`,
each producing a distinct, actionable message naming the operator's
remedy; it MUST NOT collapse any of the three into a generic execution
failure.

#### Scenario: Missing binary is classified not-installed

- GIVEN `execFile` fails with `ENOENT`
- WHEN the client classifies the failure
- THEN it returns a not-installed error naming the binary and its install
  remedy

#### Scenario: Unauthenticated CLI is classified not-authenticated

- GIVEN the CLI exits with its own non-interactive login-required message
- WHEN the client classifies the failure
- THEN it returns a not-authenticated error naming `MAGENTO_CLOUD_CLI_TOKEN`
  as the remedy

#### Scenario: Unsupported CLI version is classified distinctly

- GIVEN the resolved CLI reports a version outside the supported range
- WHEN the client classifies the failure
- THEN it returns an unsupported-version error, distinct from the other
  two, naming the required version

### Requirement: Non-Interactive Execution Guarantee

Every spawned `magento-cloud` invocation MUST use `stdio: "pipe"`, so the
child never has a controlling TTY and its interactive-login branch is
structurally unreachable.

#### Scenario: Spawn options never request a TTY

- GIVEN any client-initiated spawn
- WHEN the captured spawn options are inspected
- THEN `stdio` is `"pipe"`, never `"inherit"`

### Requirement: Timeout-vs-Output-Cap Disambiguation

The client MUST distinguish a wall-clock timeout from a `maxOutputBytes`
overflow by comparing elapsed time against `timeoutMs` and captured output
length against `maxOutputBytes`, and MUST produce a distinct message for
each; when both conditions hold it MUST name both causes and both remedies
rather than asserting a single wrong cause.

#### Scenario: Output-cap overflow is classified output-cap-exceeded

- GIVEN a call whose captured output reaches `maxOutputBytes` while
  elapsed time remains well under `timeoutMs`
- WHEN the client classifies the result
- THEN it reports `output-cap-exceeded`, distinct from a timeout

#### Scenario: Wall-clock timeout is classified timed-out

- GIVEN a call whose elapsed time reaches `timeoutMs` while captured
  output remains below `maxOutputBytes`
- WHEN the client classifies the result
- THEN it reports `timed-out`, distinct from an output-cap overflow

### Requirement: serviceEndpoints Credential Stripping at the Client Boundary

The client MUST strip username and password from any relationships-derived
`serviceEndpoints` value before it leaves the client, returning only host,
port, scheme, and service.

#### Scenario: Username and password never leave the client

- GIVEN a synthetic relationships fixture whose service entry carries
  `username` and `password`
- WHEN the client builds a `serviceEndpoints` value from it
- THEN the returned value contains only `host`, `port`, `scheme`, and
  `service`, with no username- or password-shaped field
