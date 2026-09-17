# Delta for mcp-core

## MODIFIED Requirements

### Requirement: Allowlisted Command Executor

The command executor MUST use `execFile` and MUST NOT use `exec` or any
shell string interpolation. It MUST allowlist commands by full subcommand
name only (never prefix or regex match), MUST validate every argument
against a schema, MUST reject any `--` passthrough argument, and MUST
reject the specific forbidden operations `ssh`, `tunnel`, and `db:dump`
outright. It MUST enforce a required `timeoutMs` and `maxOutputBytes` for
every invocation. It MUST accept an optional, explicit per-spec child
environment (`CommandSpec.env`) and, when spawning the child, MUST pass
exactly that map as the process environment — it MUST NEVER spread
`process.env` into it, in whole or in part, as an assertable property, not
an incidental consequence of a hardcoded value. A spec supplying no `env`
MUST still spawn its child with exactly `{}`, preserving the executor's
existing behavior for every caller that does not opt in.
(Previously: `env` was hardcoded to `{}` unconditionally with no override
point; `CommandSpec` had no `env` field at all, so no caller could ever
supply one and no authenticated external CLI could function through the
executor.)

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
- THEN it rejects the request unconditionally, even if that name were
  otherwise allowlisted

#### Scenario: Passthrough argument is rejected

- GIVEN a caller supplies an argument list containing `--`
- WHEN the executor validates the arguments
- THEN it rejects the request before any process is spawned

#### Scenario: Schema-invalid argument is rejected

- GIVEN an argument that fails its declared zod schema (e.g. a non-numeric
  value where an integer is required)
- WHEN the executor validates the arguments
- THEN it rejects the request and does not invoke `execFile`

#### Scenario: Validator returns the exact executed string

- GIVEN a raw input string containing characters the validator's internal
  representation would otherwise normalize differently
- WHEN the validator both validates and reports the command it will run
- THEN the string it returns is byte-identical to what `execFile` actually
  receives, proven by a property test comparing the validator's output
  against the captured `execFile` call arguments

#### Scenario: Timeout and output-cap are enforced

- GIVEN a command configured with `timeoutMs: 100` and
  `maxOutputBytes: 1024`
- WHEN the underlying process exceeds either the time or the output size
- THEN the executor terminates it and returns a bounded, truncated result
  rather than hanging or returning unbounded output

#### Scenario: An explicit env is passed to the child exactly

- GIVEN a `CommandSpec` with `env: { EXAMPLE_VAR: "value" }`
- WHEN the executor spawns the child
- THEN the captured `execFile` options' `env` is exactly
  `{ EXAMPLE_VAR: "value" }`

#### Scenario: process.env is never inherited, with or without an explicit env

- GIVEN a sentinel variable set in the parent process, and separately a
  `CommandSpec` with an explicit `env` and one with no `env`
- WHEN the executor spawns each child
- THEN neither child's captured `env` contains the parent's sentinel
  variable

#### Scenario: A spec with no env still spawns with exactly {}

- GIVEN a `CommandSpec` with no `env` field supplied
- WHEN the executor spawns the child
- THEN the captured `execFile` options' `env` is exactly `{}`, identical
  to the executor's behavior before this change
