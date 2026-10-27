# Delta for eds-mcp

## REMOVED Requirements

### Requirement: Nine-Tool Task-Shaped Surface

(Replaced by "Fourteen-Tool Surface With a Single Write Entry Point". `eds_set_live_state`,
`eds_reindex` and `eds_manage_snapshot` are removed; their operations move into `eds_plan`.)

### Requirement: Full-Site Reindex Requires Both Gate Fields

(Replaced by "Full-Site Reindex Operation Requires the Literal Gate Field", which keeps the same
gate inside the `eds_plan` operation union.)

## MODIFIED Requirements

### Requirement: Annotations Match Declared Read/Destructive/Idempotent Semantics

Each tool's `readOnlyHint`, `destructiveHint`, and `idempotentHint` MUST match its documented
triple: every tool except `eds_apply` — `eds_get_status`, `eds_get_status_bulk`,
`eds_get_site_config`, `eds_get_audit_log`, `eds_get_snapshots`, `eds_get_job_status`,
`eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`, `eds_get_code_status`,
`eds_list_jobs`, `eds_list_api_keys` and `eds_plan` — is `true/false/true`; `eds_apply` is
`false/true/false`.
(Previously: three write tools with three different triples.)

#### Scenario: eds_plan is read-only

- GIVEN `eds_plan`'s registration
- WHEN its annotations are inspected
- THEN `readOnlyHint` is `true`, `destructiveHint` is `false`, and `idempotentHint` is `true`

#### Scenario: Mutating, non-idempotent tool is annotated correctly

(Previously described `eds_manage_snapshot`, which is removed; `eds_apply` is now the only mutating
tool.)

- GIVEN `eds_apply`'s registration
- WHEN its annotations are inspected
- THEN `readOnlyHint` is `false`, `destructiveHint` is `true`, and `idempotentHint` is `false`

### Requirement: Bulk Write paths Is Non-Empty

Every `paths` field — on `eds_get_status_bulk` and on every `eds_plan` operation kind that
accepts paths — MUST reject an omitted or empty array at the schema level, and MUST reject more
than 100 entries.
(Previously: applied to `eds_set_live_state` and `eds_reindex`, which no longer exist.)

#### Scenario: Empty paths array is a schema rejection

- GIVEN a call to `eds_plan` with `operation: { kind: "live.publish", paths: [] }`
- WHEN the tool validates the input
- THEN the call is rejected before any request is issued, never interpreted as "all paths"

## ADDED Requirements

### Requirement: Fourteen-Tool Surface With a Single Write Entry Point

The server MUST expose exactly these fourteen tools and no others: `eds_get_status`,
`eds_get_status_bulk`, `eds_get_site_config`, `eds_get_audit_log`, `eds_get_snapshots`,
`eds_get_job_status`, `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`,
`eds_get_code_status`, `eds_list_jobs`, `eds_list_api_keys`, `eds_plan`, `eds_apply`. `eds_apply`
MUST be the only tool that issues an Admin API write request. Each tool's description MUST state
when to use it.

#### Scenario: tools/list matches the declared surface exactly

- GIVEN the running server
- WHEN `tools/list` is called
- THEN the response contains exactly these fourteen tool names, and none of
  `eds_set_live_state`, `eds_reindex`, `eds_manage_snapshot`

#### Scenario: Read tools never write

- GIVEN any tool other than `eds_apply`, called with valid input
- WHEN its requests are recorded by the fetch double
- THEN none uses `PUT`, `DELETE`, or a `POST` other than the query-only bulk-status `POST`

### Requirement: eds_plan Supports Every Write Operation Kind

`eds_plan` MUST accept `{ site, ref?, operation }`, where `operation` is a discriminated union on
`kind` with exactly these kinds: `config.patch`, `site.create`, `site.delete`, `version.restore`,
`robots.set`, `preview.update`, `preview.delete`, `live.publish`, `live.unpublish`,
`index.update`, `index.delete`, `index.full-site`, `cache.purge`, `sitemap.rebuild`, `code.sync`,
`code.delete`, `job.stop`, `snapshot.add`, `snapshot.remove`, `snapshot.publish`,
`snapshot.review`, `snapshot.delete` — twenty-two kinds. Every branch MUST be strict. `eds_plan` MUST
NOT issue any write request.

#### Scenario: Planning issues no write

- GIVEN a valid `eds_plan` call for any operation kind
- WHEN its requests are recorded
- THEN only reads were issued

#### Scenario: Unknown kind is rejected

- GIVEN `operation: { kind: "site.rename" }`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

### Requirement: Plan Result Carries Token, Changes, Message and Instruction

A planned result MUST include a one-time `token`, its `expiresAt`, the `site`, the `kind`, a
one-line `summary`, the list of requests that `eds_apply` will issue (method and path), all
`warnings`, a server-assembled `confirmationMessage`, a fixed `instruction` telling the model to
show the message and to call `eds_apply` only after the user's latest message explicitly confirms
the plan, and `requiresConfirmSite`. For configuration kinds it MUST also include, for every
changed key, its JSON Pointer, previous value and new value. All plan output MUST pass through
redaction.

#### Scenario: Config plan shows every changed key

- GIVEN `acme-demo-site-eu` whose document has `{ "a": 1, "b": { "c": 2 } }`
- WHEN `eds_plan` is called with `config.patch` and `patch: { "b": { "c": 3 }, "d": true }`
- THEN `changes` contains `/b/c` from `2` to `3` and `/d` from absent to `true`, and nothing else

#### Scenario: Instruction is present in every planned result

- GIVEN any planned result
- WHEN it is inspected
- THEN `instruction` is the fixed confirmation instruction and `confirmationMessage` is non-empty

#### Scenario: Secret-shaped value is redacted

- GIVEN a site document containing a token-shaped value
- WHEN a `config.patch` plan is returned
- THEN the token-shaped value does not appear in the output

### Requirement: No-Op Configuration Plan Issues No Token

When a configuration plan produces an empty diff, `eds_plan` MUST return `status: "no-changes"`
and MUST NOT issue a token.

#### Scenario: Patch equal to current state

- GIVEN a site document `{ "a": 1 }`
- WHEN `eds_plan` is called with `config.patch` and `patch: { "a": 1 }`
- THEN the result is `no-changes` and contains no token

### Requirement: eds_apply Accepts Only a Token

`eds_apply` MUST accept exactly `{ token, confirmSite?, wait? }` and MUST reject any other field.
It MUST issue exactly the requests recorded when the token was planned — same methods, paths,
bodies and content types — and nothing else.

#### Scenario: Extra operation field is rejected

- GIVEN a call to `eds_apply` with a valid token and `site: "acme-demo-site-us"`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level and no request is issued

#### Scenario: Applied requests equal planned requests

- GIVEN a plan whose recorded requests are R
- WHEN `eds_apply` is called with its token
- THEN the write requests issued are exactly R, in order, byte for byte

### Requirement: Tokens Are Single-Use, Expiring and Unforgeable

A token MUST be generated from at least 32 random bytes, MUST expire 10 minutes after issue, and
MUST be consumed when `eds_apply` starts processing it. An unknown, expired or already-consumed
token MUST be rejected with no request issued. Tokens MUST NOT survive a server restart.

#### Scenario: Reused token is rejected

- GIVEN a token that has already been passed to `eds_apply` once
- WHEN `eds_apply` is called with it again
- THEN the result is `rejected` with reason `used`, and no request is issued

#### Scenario: Expired token is rejected

- GIVEN a token issued more than 10 minutes ago
- WHEN `eds_apply` is called with it
- THEN the result is `rejected` with reason `expired`, and no request is issued

#### Scenario: Forged token is rejected

- GIVEN a string that was never issued as a token
- WHEN `eds_apply` is called with it
- THEN the result is `rejected` with reason `unknown-token`, and no request is issued

### Requirement: Stale Configuration Plans Are Rejected

For `config.patch`, `site.delete`, `version.restore` and `robots.set`, `eds_apply`
MUST re-read the state the plan was computed from and MUST reject the apply, issuing no write, if
its canonical-JSON SHA-256 differs from the one recorded at plan time. For `site.create` it MUST
reject if the site exists at apply time.

#### Scenario: Config changed between plan and apply

- GIVEN a `config.patch` plan for `acme-demo-site-eu`
- AND the site document changes before `eds_apply`
- WHEN `eds_apply` is called with the token
- THEN the result is `rejected` with reason `stale-plan`, and no write is issued

#### Scenario: Site created by someone else after the plan

- GIVEN a `site.create` plan for `acme-demo-site-us`, planned while the site did not exist
- AND the site exists by the time of `eds_apply`
- WHEN `eds_apply` is called with the token
- THEN the result is `rejected` with reason `stale-plan`, and no `PUT` is issued

### Requirement: Protected Sites Require the Site Name

When the planned site matches a pattern in `EDS_PROTECTED_SITES` (comma-separated; `*` is the only
wildcard; anchored; case-sensitive), the plan MUST set `requiresConfirmSite: true` and add a
warning, and `eds_apply` MUST reject a missing or non-identical `confirmSite` without consuming
the token.

#### Scenario: Protected site without confirmSite

- GIVEN `EDS_PROTECTED_SITES="*-us"` and a plan for `acme-demo-site-us`
- WHEN `eds_apply` is called with the token and no `confirmSite`
- THEN the result is `rejected` with reason `confirm-site-missing`, no request is issued, and the
  same token is still accepted afterwards with `confirmSite: "acme-demo-site-us"`

#### Scenario: Pattern characters other than * are literal

- GIVEN `EDS_PROTECTED_SITES="acme.demo"`
- WHEN a plan is built for `acme-demo`
- THEN the site is not protected

### Requirement: AEM Content Source Warning

A `preview.*` or `live.*` plan for a site whose `content.source.type` is `markup` and whose
`content.source.url` contains `/bin/franklin.delivery` MUST include a warning that the operation leaves no replication record in
AEM and that publishing from AEM is preferable when an audit trail is required.

#### Scenario: AEM-sourced site gets the warning

- GIVEN a site whose content source URL is an AEM author delivery URL
- WHEN a `live.publish` plan is built
- THEN `warnings` contains the AEM warning

#### Scenario: Other content sources do not

- GIVEN a site whose content source is not AEM
- WHEN a `live.publish` plan is built
- THEN `warnings` contains no AEM warning

#### Scenario: Site document not readable with the key

- GIVEN a key without `config_admin`, which the Admin API answers with 403 on the site document
- WHEN a `live.publish` plan is built
- THEN the plan is still produced, and `warnings` says that the AEM check was skipped
- AND a 401 on the same read still fails the plan

### Requirement: Code Operations Resolve the Repository From the Site

`code.sync` and `code.delete` MUST NOT accept `owner` or `repo` fields. The repository MUST be
resolved from the site's `code` configuration at plan time and MUST appear in the confirmation
message. `eds_get_code_status` MUST resolve it the same way.

#### Scenario: owner supplied by the model is rejected

- GIVEN `operation: { kind: "code.sync", paths: ["/scripts/a.js"], owner: "other-owner" }`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

### Requirement: Full-Site Reindex Operation Requires the Literal Gate Field

The `index.full-site` operation kind MUST require `confirmFullReindex: true` as a literal. Its
recorded request MUST be the contract's full-site reindex, a `POST /index/{org}/{site}/{ref}/*`
with no body, and its plan MUST carry a full-site reindex warning. `index.update` MUST record a
body of exactly `{ paths }`. No other operation kind MAY record a bodyless index `POST`.
(Previously: the full-site request had to carry an explicit `{ scope: "full-site" }` body and a
bodyless `POST` was forbidden. The contract documents the bodyless `POST` as the full-site reindex,
and its body schema has only `paths`. The accidental bodyless call that the old rule guarded
against cannot happen now: the only way to record one is this kind, which requires the literal gate
and goes through plan/apply.)

#### Scenario: Gate field omitted

- GIVEN `operation: { kind: "index.full-site" }`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

#### Scenario: Full-site plan records the bodyless reindex

- GIVEN `operation: { kind: "index.full-site", confirmFullReindex: true }` for `acme-demo-site-eu`
- WHEN the plan is built
- THEN its only recorded request is `POST /index/acme-demo-org/acme-demo-site-eu/main/*` with no
  body, and `warnings` contains the full-site reindex warning

#### Scenario: Path reindex sends only paths

- GIVEN `operation: { kind: "index.update", paths: ["/products/demo"] }`
- WHEN the plan is built
- THEN the recorded body is exactly `{ "paths": ["/products/demo"] }`

### Requirement: Apply Result Reserves a Pending Status

The `eds_apply` result type MUST include `status: "pending"` as a member, and no code path in this
change MAY produce it.

#### Scenario: pending is never produced

- GIVEN every operation kind applied with a valid token
- WHEN the results are inspected
- THEN none has `status: "pending"`

### Requirement: API Key Writes Stay Off the MCP Surface

No `eds_plan` operation kind and no tool MAY create or delete an API key. Creating one returns its
value exactly once, and that value would enter the model's context. Deleting one is an org-level
operation (API keys are an org resource) that does not fit `eds_plan`'s site-scoped input or
protected-site matching. Both stay CLI-only. `eds_list_api_keys` MUST take no `site` field, MUST
list the org's keys, and MUST return metadata only.

#### Scenario: key.create is not a kind

- GIVEN `operation: { kind: "key.create" }`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

#### Scenario: key.delete is not a kind

- GIVEN `operation: { kind: "key.delete", id: "key-demo-1" }`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

#### Scenario: Key listing is org-level

- GIVEN a call to `eds_list_api_keys` with `site: "acme-demo-site-eu"`
- WHEN the tool validates the input
- THEN the call is rejected at the schema level

### Requirement: eds_apply Requires User Interaction in Clients That Support It

`eds_apply`'s `tools/list` entry MUST carry `_meta: { "anthropic/requiresUserInteraction": true }`,
with the JSON Boolean `true`. No other tool MAY carry that key. The server MUST NOT depend on any
client honouring it; the token, the instruction and the confirmation message stay the mechanism
for every client.

#### Scenario: Only eds_apply is marked

- GIVEN the running server
- WHEN `tools/list` is called
- THEN `eds_apply` has `_meta["anthropic/requiresUserInteraction"]` equal to `true`, and no other
  tool has that key
