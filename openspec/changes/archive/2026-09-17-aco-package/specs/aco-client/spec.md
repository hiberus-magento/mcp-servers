# ACO Client Specification

## Purpose

Defines `packages/aco/src/client/`, the Adobe Commerce Optimizer (ACO)
domain client: the admin and Merchandising endpoint shapes, the three
credential models kept apart, the `HTTP 200 + errors[]` typed error
hierarchy keyed off `extensions`, heuristic throttle detection, `scrollId`
pagination, and the `provision` pipeline. `client/index.ts` is its only
public surface.

## Requirements

### Requirement: Client Module Purity

The `client/` module MUST NOT call any `console.*` method, MUST NOT call
`process.exit`, MUST NOT prompt for input, MUST NOT emit ANSI color codes,
and MUST NOT read `process.env` directly. Every function MUST return a
plain object, never a formatted string.

#### Scenario: No forbidden calls in client source

- GIVEN the `client/` source tree
- WHEN a static scan checks for `console.`, `process.exit`, `process.env`,
  prompt libraries, and ANSI escape sequences
- THEN none are found

### Requirement: Client Boundary Import

Adapters (`cli.ts`, `mcp.ts`) MUST import only `client/index.ts`; any
deeper import MUST fail lint.

#### Scenario: Deep import is rejected by lint

- GIVEN an adapter file importing a `client/` path other than `index.ts`
- WHEN eslint's `no-restricted-imports` boundary rule runs
- THEN the deep import is reported as a lint error

### Requirement: Track-Separated Credential Headers

The client MUST send the admin track's `Authorization: Bearer <token>` and
`x-api-key` only to the admin endpoint, MUST send the Merchandising track's
optional `AC-Catalog-View-Access-Token` (from an injected supplier) only to
the Merchandising endpoint, and MUST NEVER send `X-Auth-Token` (EDS's
header) on any request. An unprotected Merchandising call MUST carry no
authorization-shaped header at all.

#### Scenario: Admin request carries Bearer and x-api-key

- GIVEN a client configured with an admin credential
- WHEN it issues an admin GraphQL request
- THEN the request carries `Authorization: Bearer <token>` and `x-api-key`,
  and no `AC-Catalog-View-Access-Token`

#### Scenario: Unprotected Merchandising request carries no secret

- GIVEN a client call to an unprotected catalog view with no access-token
  supplier configured
- WHEN it issues the request
- THEN the request carries `AC-View-ID` and `AC-Scope-Locale` only, with no
  `Authorization`, `x-api-key`, or `X-Auth-Token` header present

### Requirement: HTTP 200 with errors[] Is Never Success

The client MUST classify any GraphQL response body containing a non-empty
`errors[]` array as a failure, regardless of `response.status` or
`response.ok`.

#### Scenario: 200 with errors[] is not treated as success

- GIVEN a response with `status: 200`, `ok: true`, and a non-empty
  `errors[]` array
- WHEN the client processes it
- THEN it reports a failure, and the assertion proves both the `200`
  status and the failure classification in the same test

### Requirement: Typed Error Classification Keyed off extensions

The client MUST classify a GraphQL error by inspecting
`errors[].extensions`, never `response.status`: `x-commerce-exception:
"access-key-invalid"` MUST become `CatalogViewAccessError`; a
`classification`/`code` matching `permission|scope|unauthor|forbidden`
MUST become `AdminScopeError` naming both re-mint and paste remedies; a
throttle-shaped `classification`/`code` MUST become `AcoThrottledError`;
any other `errors[]` entry MUST become `AcoOperationError` carrying
`message` and `extensions` verbatim. A transport-level failure (rejected
fetch, a 5xx with no GraphQL envelope) MUST be a distinct class from all
of the above.

#### Scenario: Missing access key is classified precisely

- GIVEN a Merchandising response with `extensions["x-commerce-exception"]
  = "access-key-invalid"` and message `"Access key validation failed:
  Missing token"`
- WHEN the client classifies it
- THEN it returns a `CatalogViewAccessError` naming the Studio
  registration/rotation remedy

#### Scenario: Admin scope failure names both exits

- GIVEN an admin response whose error `classification` matches
  `permission|scope|unauthor|forbidden`
- WHEN the client classifies it
- THEN the resulting error names both re-attempting the mint and pasting a
  Studio Bearer as remedies

### Requirement: Heuristic Throttle Detection Reads extensions Only

Throttle detection MUST parse `errors[].extensions` and MUST NOT consult
`response.status` for this signal, and the classifier MUST be documented
at its definition as heuristic, not a confirmed Adobe contract.

#### Scenario: Raw 429 with no errors[] is not a throttle

- GIVEN a response with HTTP status `429` and no `errors[]` array
- WHEN the client evaluates it for throttling
- THEN it is not classified as `AcoThrottledError`

#### Scenario: 200 with throttle-shaped extension is a throttle

- GIVEN a `200` response whose `errors[]` entry carries a throttle-shaped
  `extensions.classification`
- WHEN the client evaluates it
- THEN it is classified as `AcoThrottledError`

### Requirement: scrollId Pagination Confined to priceBooks

Only the price-books query MAY accept and return `scrollId`; no other
client method MAY accept or return one.

#### Scenario: scrollId round-trips across two pages

- GIVEN a price-books response containing `scrollId: "abc"`
- WHEN the client requests the next page with that `scrollId`
- THEN the second request carries it and the client's result surfaces the
  response's own `scrollId` for further paging

### Requirement: provision Is Dry-Run by Default and Idempotent

`provision` MUST issue zero mutation requests unless an explicit write
flag is set, and MUST be idempotent by name-keyed lookup: running it twice
against unchanged state MUST issue mutations only on the first pass.

#### Scenario: Default invocation issues no writes

- GIVEN a `provision` call with no explicit write flag
- WHEN it runs
- THEN zero `create`/`update`/`delete` mutation requests are issued

#### Scenario: Second run against unchanged state is a no-op

- GIVEN `provision` already ran once with writes enabled against a fixture
- WHEN it runs again with writes enabled against the same state
- THEN no mutation requests are issued on the second run

### Requirement: provision Aborts Before Any Write on Zero-Match Validation

If the validate-attribute step finds a vertical whose expected value
matches zero products, `provision` MUST abort before issuing any create or
update mutation.

#### Scenario: Zero-match vertical aborts the run

- GIVEN a vertical whose expected attribute value matches zero products
  in the fixture
- WHEN `provision` runs with writes enabled
- THEN no mutation request is issued for any vertical in that run

### Requirement: Facet Query Returns a Structured Non-Facetable Result

When an attribute is not facetable, the client's facet-values function
MUST return `{ facetable: false, reason }` and MUST NOT itself issue the
page-sampling fallback that brute-forces facet values via repeated
product-list queries.

#### Scenario: Non-facetable attribute returns a structured result

- GIVEN an attribute with no facet bucket data
- WHEN the client requests its facet values
- THEN it returns `{ facetable: false, reason }` and issues no additional
  product-list request

### Requirement: Conservative Token-Bucket Pacing

The client MUST reuse a token-bucket rate limiter for mutation fan-out
(`provision`'s create/update loop) and MUST NOT use a fixed `sleep` delay.

#### Scenario: Mutation fan-out is paced by the limiter, not a fixed sleep

- GIVEN more mutation requests queued than the configured bucket rate
- WHEN the client issues them, observed under fake timers
- THEN requests are paced according to the token-bucket limiter and no
  fixed-duration sleep call is present in the pacing path

### Requirement: Tolerant Response Parsing

The client MUST NOT throw on an unrecognized or missing optional field in
a GraphQL response; unknown fields pass through and missing optional
fields resolve to `undefined`.

#### Scenario: Unexpected field does not crash a tool call

- GIVEN a response containing a field the client's type does not declare
- WHEN the client parses it
- THEN parsing succeeds and the unexpected field is ignored
