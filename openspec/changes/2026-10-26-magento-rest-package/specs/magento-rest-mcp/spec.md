# Spec: magento-rest-mcp

## Requirement: Read-Only Default
With `MAGENTO_REST_ALLOW_WRITES` unset, or set to any value other than the exact string `true`, the server MUST register read tools only. A write tool MUST NOT appear in `tools/list`.

#### Scenario: switch unset
- WHEN `tools/list` is called
- THEN every tool MUST carry `readOnlyHint: true`

#### Scenario: switch set to `1`
- WHEN `tools/list` is called
- THEN no write tool MUST appear

#### Scenario: switch set to `true`
- WHEN `tools/list` is called
- THEN the write tools MUST appear alongside every read tool, and a warning MUST be logged to stderr

## Requirement: Output Allowlist
Every tool MUST project its result through a declared shape. A field not in the shape MUST NOT appear in what the tool returns.

## Requirement: Additive Field Configuration
`MAGENTO_REST_FIELDS_FILE`, when set, MUST name a JSON file whose resources each carry only an `add` array of field paths. The server MUST apply those paths on top of the shipped allowlists and MUST NOT remove or replace any shipped field.

#### Scenario: a field is added
- GIVEN a file `{"product":{"add":["cost"]}}`
- WHEN a tool that returns a product is called
- THEN `cost` MUST appear in the result, and no other undeclared field MUST

#### Scenario: a credential or payment path
- GIVEN a file that adds `password_hash`, `payment.cc_number` or `extension_attributes.payment_additional_info`, in any letter case
- THEN the server MUST refuse to start with a message containing "cannot be added by configuration"

#### Scenario: a file that tries to narrow, replace or widen without limit
- GIVEN a resource carrying `remove`, `replace` or any key other than `add`, or a path of `*`
- THEN the server MUST refuse to start

#### Scenario: an invalid or unreadable file
- GIVEN a path that does not exist, is a directory, exceeds 64 KB, is not JSON, or names an unknown resource
- THEN the server MUST exit with code 1 and a message naming the variable and the reason, before connecting its transport, and MUST NOT start with a partial configuration

#### Scenario: no file
- WHEN the variable is unset or empty
- THEN the shipped allowlists MUST apply unchanged

#### Scenario: a valid file
- THEN `tools/list` MUST be the same as without it, and the widened resources MUST be logged to stderr

## Requirement: Strict Input
Every tool MUST reject an argument it does not declare, and every list tool MUST bound `page_size` to 1–100.

## Requirement: Annotations Follow the Effect
A read tool MUST be `readOnlyHint: true, destructiveHint: false, idempotentHint: true`. A write tool MUST NOT be read-only; update, delete and action tools MUST be destructive; create and action tools MUST NOT be idempotent.

## Requirement: Verification Marker
A tool not listed in `LIVE_VERIFIED_TOOLS` MUST carry "Not verified against a live service" in its shipped description and in `servers.json`; a tool listed MUST carry it in neither.

## Requirement: Lazy Configuration
`tools/list` MUST work with no configuration. A missing `MAGENTO_REST_BASE_URL` MUST fail the first `tools/call` with an error naming the variable.

## Requirement: Manifest Coherence
`servers.json`'s tool names and `readOnly` flags MUST equal the registered tools and their annotations.

## Requirement: Stdout Purity
Stdout MUST carry JSON-RPC only; the bundle MUST pass the shared conformance suite, stay under 2 MB per binary, and declare no dependencies.
