# MCP Core Specification

## Purpose

Defines the shared `@hiberus-magento/mcp-core` policy library: the six structural safety primitives every MCP server package builds on — stdout-safe bootstrap, compile-time-enforced tool definitions, an allowlisted command executor, output truncation/pagination, secret redaction, and credential loading.

## Requirements

### Requirement: Stdout Reserved Exclusively for JSON-RPC

The server bootstrap MUST make writing to stdout outside the JSON-RPC transport structurally impossible: the bootstrap module MUST NOT expose `console.log`/`process.stdout.write` to application code, and any logging helper it exports MUST write to stderr only.

#### Scenario: Application code has no stdout logging path

- GIVEN a package built on the mcp-core bootstrap
- WHEN application code calls the exported logger
- THEN the log line is written to stderr and stdout receives nothing

#### Scenario: Direct stdout write is caught by conformance

- GIVEN a server under test emits a stray line via a raw `process.stdout.write` call bypassing the logger
- WHEN the conformance suite's stdout-purity check runs against the server's stdio stream
- THEN it detects the non-JSON-RPC line and fails

### Requirement: defineTool Compile-Time Annotation Enforcement

`defineTool()` MUST require a zod input schema, a non-empty description, and all three MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) as part of its TypeScript type signature, such that omitting any of them fails `tsc`, not the test runner.

#### Scenario: Complete tool definition compiles

- GIVEN a `defineTool()` call supplying a schema, description, and all three annotations
- WHEN `tsc` type-checks the file
- THEN it compiles with no errors

#### Scenario: Missing annotation fails to compile

- GIVEN a `defineTool()` call omitting `destructiveHint`
- WHEN `tsc` type-checks the file
- THEN compilation fails with a type error, proven by a type-level test (e.g. `expect-type`/`tsd`) asserting the call site is ill-typed

### Requirement: Allowlisted Command Executor

The command executor MUST use `execFile` and MUST NOT use `exec` or any shell string interpolation. It MUST allowlist commands by full subcommand name only (never prefix or regex match), MUST validate every argument against a schema, MUST reject any `--` passthrough argument, and MUST reject the specific forbidden operations `ssh`, `tunnel`, and `db:dump` outright. It MUST enforce a required `timeoutMs` and `maxOutputBytes` for every invocation. It MUST accept an optional, explicit per-spec child environment (`CommandSpec.env`) and, when spawning the child, MUST pass exactly that map as the process environment — it MUST NEVER spread `process.env` into it, in whole or in part, as an assertable property, not an incidental consequence of a hardcoded value. A spec supplying no `env` MUST still spawn its child with exactly `{}`, preserving the executor's existing behavior for every caller that does not opt in.
(Previously: `env` was hardcoded to `{}` unconditionally with no override point; `CommandSpec` had no `env` field at all, so no caller could ever supply one and no authenticated external CLI could function through the executor.)

#### Scenario: Full-name allowlist match

- GIVEN the executor is configured to allow only the exact command `status`
- WHEN a caller requests `status`
- THEN the executor runs it via `execFile`

#### Scenario: Prefix match is rejected

- GIVEN the allowlist contains only `status`
- WHEN a caller requests `status-extended`
- THEN the executor rejects the request without executing anything

#### Scenario: Forbidden operation is rejected

- GIVEN a caller requests `ssh`, `tunnel`, or `db:dump`
- WHEN the executor evaluates the request
- THEN it rejects the request unconditionally, even if that name were otherwise allowlisted

#### Scenario: Passthrough argument is rejected

- GIVEN a caller supplies an argument list containing `--`
- WHEN the executor validates the arguments
- THEN it rejects the request before any process is spawned

#### Scenario: Schema-invalid argument is rejected

- GIVEN an argument that fails its declared zod schema (e.g. a non-numeric value where an integer is required)
- WHEN the executor validates the arguments
- THEN it rejects the request and does not invoke `execFile`

#### Scenario: Validator returns the exact executed string

- GIVEN a raw input string containing characters the validator's internal representation would otherwise normalize differently
- WHEN the validator both validates and reports the command it will run
- THEN the string it returns is byte-identical to what `execFile` actually receives, proven by a property test comparing the validator's output against the captured `execFile` call arguments

#### Scenario: Timeout and output-cap are enforced

- GIVEN a command configured with `timeoutMs: 100` and `maxOutputBytes: 1024`
- WHEN the underlying process exceeds either the time or the output size
- THEN the executor terminates it and returns a bounded, truncated result rather than hanging or returning unbounded output

#### Scenario: An explicit env is passed to the child exactly

- GIVEN a `CommandSpec` with `env: { EXAMPLE_VAR: "value" }`
- WHEN the executor spawns the child
- THEN the captured `execFile` options' `env` is exactly `{ EXAMPLE_VAR: "value" }`

#### Scenario: process.env is never inherited, with or without an explicit env

- GIVEN a sentinel variable set in the parent process, and separately a `CommandSpec` with an explicit `env` and one with no `env`
- WHEN the executor spawns each child
- THEN neither child's captured `env` contains the parent's sentinel variable

#### Scenario: A spec with no env still spawns with exactly {}

- GIVEN a `CommandSpec` with no `env` field supplied
- WHEN the executor spawns the child
- THEN the captured `execFile` options' `env` is exactly `{}`, identical to the executor's behavior before this change

### Requirement: Output Truncation and Pagination

Tool output exceeding a configured byte limit MUST be truncated with an explicit truncation marker, and any tool returning a paginable collection MUST accept a pagination parameter.

#### Scenario: Oversized output is truncated with a marker

- GIVEN output exceeding the configured byte limit
- WHEN the executor returns it to the caller
- THEN the returned payload is capped at the limit and ends with an explicit truncation marker indicating more data was cut

#### Scenario: Paginated tool honors a page parameter

- GIVEN a tool that lists a collection larger than one page
- WHEN called with a pagination parameter requesting the second page
- THEN it returns only that page's items, not the whole collection

### Requirement: Linear-Time Secret Redaction

Redaction MUST mask key/value secret pairs and `scheme://user:pass@host` URLs in log and error output, and MUST run in linear time with respect to input length (no catastrophic-backtracking regex).

#### Scenario: Key/value secret is masked

- GIVEN a log line containing `token=abc123secret`
- WHEN redaction runs
- THEN the value is replaced with a mask and `abc123secret` does not appear in the output

#### Scenario: Credentialed URL is masked

- GIVEN a log line containing `https://user:hunter2@example.test/api`
- WHEN redaction runs
- THEN the userinfo portion is masked and `hunter2` does not appear in the output

#### Scenario: Backtracking safety on adversarial input

- GIVEN an adversarially crafted input (e.g. a long run of near-matching key=value-like characters) of length N
- WHEN redaction runs
- THEN execution time scales linearly with N, proven by a test asserting completion within a fixed time bound as N grows, rather than degrading exponentially

### Requirement: Credential Loading Precedence and Storage

Credential loading MUST resolve an environment variable over a config file value for the same domain. When persisting a credential, it MUST write to `$XDG_CONFIG_HOME/hiberus/<domain>.json` at file mode `0600`. It MUST NEVER accept a token as a command-line argument; tokens MUST be accepted via stdin or environment variable only. Domain-specific credential sources MUST implement a shared `TokenProvider` interface.

#### Scenario: Environment variable wins over config file

- GIVEN both an environment variable and a config file supply a value for the same domain
- WHEN the credential loader resolves the value
- THEN it returns the environment variable's value

#### Scenario: Persisted credential file has restrictive permissions

- GIVEN a credential is persisted for domain `example-domain`
- WHEN the file is written
- THEN it is written to `$XDG_CONFIG_HOME/hiberus/example-domain.json` with mode `0600`

#### Scenario: CLI argument token is rejected

- GIVEN a CLI invocation passing a token value as a positional or flag argument
- WHEN the CLI's argument parser processes it
- THEN it rejects the invocation and instructs the caller to use stdin or an environment variable instead

#### Scenario: Token accepted via stdin

- GIVEN a token piped via stdin
- WHEN the credential-setting command reads it
- THEN it accepts and persists the token without it ever appearing in the process argument list
