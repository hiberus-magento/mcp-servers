# ACO MCP Server Specification

## Purpose

Defines the `hiberus-aco-mcp` server (`packages/aco/src/mcp.ts`): its
six-tool task-shaped surface, tool annotations, the structural absence of
an "all" branch on `aco_toggle_policy_filter`, the losslessness of its
whole-policy write, and the exclusion of the brute-force facet-sampling
fallback.

## Requirements

### Requirement: Exactly Six Tools, No More

The server MUST expose exactly `aco_search_catalog`,
`aco_get_facet_values`, `aco_list_catalog_views`, `aco_list_price_books`,
`aco_list_policies`, and `aco_toggle_policy_filter`, and no others. Each
description MUST state when to use the tool.

#### Scenario: tools/list matches the declared surface exactly

- GIVEN the running server
- WHEN `tools/list` is called
- THEN the response contains exactly these six tool names

#### Scenario: No tool exists for any CLI-only operation

- GIVEN `provision`, `view delete`, `view prune`, `policy delete`,
  `api query`, and every `auth`/`profile` operation
- WHEN the registered tool name set is inspected
- THEN none of these operations corresponds to a registered tool name

### Requirement: aco_toggle_policy_filter Has No all Branch

`aco_toggle_policy_filter`'s wire schema MUST accept only `{ mode:
"named", policyName: string (min 1), attribute: string (min 1), enabled:
boolean }`; no other value of `mode` MAY type-check, and no `{ mode:
"all" }` shape MAY exist anywhere in the schema. The tool MUST address
exactly one filter in one policy per call.

#### Scenario: mode "all" does not type-check

- GIVEN the tool's zod input schema
- WHEN a type-level test attempts a call site with `mode: "all"`
- THEN the call site fails to compile

#### Scenario: An omitted target is rejected at runtime

- GIVEN a call with `mode: "named"` and no `attribute`
- WHEN the tool validates the input
- THEN the call is rejected before any request is issued

### Requirement: aco_toggle_policy_filter's Write Is Lossless

`updatePolicy` replaces the whole policy, so `aco_toggle_policy_filter`
MUST read the policy, send every field the mutation's input accepts back
unchanged, and change only the addressed filter's `enabled`. If the read
did not return a field the write must carry, or the attribute matches no
filter or more than one, the tool MUST issue no mutation and MUST report
why.

#### Scenario: Every other field survives the toggle

- GIVEN a policy whose every readable field is populated
- WHEN one of its filters is toggled
- THEN the posted mutation variables carry every other field exactly as
  read, and only that filter's `enabled` differs

#### Scenario: An incompletely read policy is not written

- GIVEN a policy whose read omitted a field the mutation's input requires
- WHEN a filter of it is toggled
- THEN no mutation is issued and the result names the missing field

### Requirement: aco_get_facet_values Never Triggers the Sampling Fallback

`aco_get_facet_values` MUST return `{ facetable: false, reason }` for a
non-facetable attribute and MUST issue no additional product-list request;
the CLI's page-sampling loop is unreachable from this tool.

#### Scenario: Non-facetable attribute issues no extra queries

- GIVEN an attribute with no facet bucket data
- WHEN `aco_get_facet_values` is called
- THEN the result is `{ facetable: false, reason }` and the fetch double's
  call count for product-list requests is unchanged from before the call

### Requirement: Admin-Track Tools Use the Admin Credential Provider

`aco_list_catalog_views`, `aco_list_price_books`, `aco_list_policies`, and
`aco_toggle_policy_filter` MUST issue admin GraphQL requests using the resolved
admin credential. A missing or expired admin credential MUST return an
error result immediately, naming the exact CLI command to fix it, and MUST
NOT hang or prompt.

#### Scenario: Missing admin credential produces an actionable error

- GIVEN no persisted admin credential and no client id/secret configured
- WHEN `aco_list_catalog_views` is called
- THEN the response has `isError: true` with text naming
  `hiberus-aco auth token set`, returned without delay

### Requirement: Merchandising-Track Tools Require No Secret by Default

`aco_search_catalog` and `aco_get_facet_values` MUST issue requests
carrying only `AC-View-ID`/`AC-Scope-Locale` (and optional
`AC-Price-Book-ID`) when the target view is unprotected, with no
`Authorization`, `x-api-key`, or `X-Auth-Token` header.

#### Scenario: Unprotected-view search needs no credential

- GIVEN a viewId with no access-token supplier configured
- WHEN `aco_search_catalog` is called
- THEN the request carries no authorization-shaped header and the call
  succeeds

### Requirement: Annotations Match Declared Read/Destructive/Idempotent Semantics

`aco_search_catalog`, `aco_get_facet_values`, `aco_list_catalog_views`,
`aco_list_price_books`, and `aco_list_policies` MUST be annotated
`true/false/true`; `aco_toggle_policy_filter` MUST be annotated
`false/true/true`.

#### Scenario: Mutating tool is annotated correctly

- GIVEN `aco_toggle_policy_filter`'s registration
- WHEN its annotations are inspected
- THEN `readOnlyHint` is `false`, `destructiveHint` is `true`, and
  `idempotentHint` is `true`

### Requirement: aco_toggle_policy_filter Is a No-Op at the Already-Held State

Toggling a filter to the state it already holds MUST NOT issue an
`updatePolicy` mutation for its policy.

#### Scenario: Already-enabled filter is not re-mutated

- GIVEN a policy whose filter on a given attribute is already enabled
- WHEN `aco_toggle_policy_filter` is called with `enabled: true` for that
  policy and attribute
- THEN no `updatePolicy` request is issued, and the result reports
  `changed: false`
