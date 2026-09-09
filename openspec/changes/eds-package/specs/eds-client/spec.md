# EDS Client Specification

## Purpose

Defines `packages/eds/src/client/`, the Edge Delivery Services (EDS) Admin API
domain client: auth header shape, request pacing, throttle disambiguation,
job success semantics, existence-check discipline, and the module's
no-side-effects purity constraints. `client/index.ts` is its only public
surface.

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

- GIVEN an adapter file importing `client/http.ts` directly
- WHEN eslint runs the `no-restricted-imports` boundary rule
- THEN the deep import is reported as a lint error

### Requirement: Auth Header Shape

The client MUST send the static API key as `X-Auth-Token: <key>` (or the
equivalent `Authorization: token <key>` form) on every Admin API request,
using a key value supplied by the caller, never read from `process.env` by
the client itself.

#### Scenario: Request carries the auth header

- GIVEN a client configured with a token value
- WHEN it issues any Admin API request
- THEN the outgoing request includes `X-Auth-Token` (or
  `Authorization: token <key>`) set to that value

### Requirement: Admin API Request Pacing

The client MUST enforce an explicit, testable rate limiter against the
documented Admin API limit of 10 requests/second per project; it MUST NOT
rely on an unbounded `sleep`-loop.

#### Scenario: Requests exceeding the documented rate are paced

- GIVEN more than 10 requests queued for the same project within one second
- WHEN the client issues them, observed under fake timers
- THEN no more than 10 are sent within any one-second window

### Requirement: 429-vs-503 Throttle Disambiguation

The client MUST distinguish a raw `429` response (Admin API rate limit) from
a `503` response whose `x-error` header contains the literal substring
`"(429)"` (content-source throttle), and MUST surface which one occurred so
the caller can report the correct remedy.

#### Scenario: Raw 429 is reported as an Admin API limit

- GIVEN the Admin API returns `429`
- WHEN the client processes the response
- THEN it reports an Admin-API-rate-limit error, distinct from a
  content-source throttle

#### Scenario: 503 with x-error (429) is reported as a content-source throttle

- GIVEN the Admin API returns `503` with an `x-error` header containing
  `"(429)"`
- WHEN the client processes the response
- THEN it reports a content-source-throttle error, distinct from an Admin
  API rate limit

### Requirement: Job Success Is Any 2xx

The client MUST treat any `2xx` status on
`GET /job/{org}/{site}/{ref}/{topic}/{jobName}` as success, including the
documented `202`, and MUST NOT compare the status to `200` as its success
test.

#### Scenario: 202 is treated as success

- GIVEN a job status response with HTTP status `202`
- WHEN the client evaluates job success
- THEN it reports the job as successfully retrieved

### Requirement: Config Write Existence Check via GET-Before-Write

Before writing a site configuration, the client MUST perform a `GET` to
determine whether the site already exists, and MUST NOT rely on catching an
HTTP `409` from the `PUT` as its sole existence check.

#### Scenario: Existing site is detected before the write

- GIVEN a site `example-site` that already exists
- WHEN the client writes its configuration
- THEN it issues a `GET` first and branches on that result, independent of
  any status code the subsequent `PUT` might return

### Requirement: Explicit JSON Body on Snapshot Writes

The client MUST always send an explicit JSON body with a content type on a
snapshot-creating `POST`, and MUST NEVER emit a bodyless snapshot POST,
since an empty body is inferred-only to mean "add everything."

#### Scenario: Snapshot POST always carries a body

- GIVEN a client call to create a snapshot, with or without paths supplied
  by the caller
- WHEN the client issues the request
- THEN the request body is non-empty JSON with a `content-type` header,
  never an empty body

### Requirement: Bulk Write Ignored-Path Reporting

When a bulk preview/publish response indicates that `/.helix/config` or
`redirects.json` was ignored, the client MUST report which submitted paths
were ignored, rather than silently dropping that information.

#### Scenario: Ignored config paths are surfaced

- GIVEN a bulk publish call submitting `/.helix/config` among other paths
- WHEN the client parses the response
- THEN its result names `/.helix/config` as an ignored path

### Requirement: Tolerant Site List Response Shape

The client MUST accept a site-list response that is either a bare array or
an object of the shape `{ sites: [...] }`, normalizing both to the same
result shape.

#### Scenario: Bare array response is accepted

- GIVEN a site-list response body that is a bare JSON array
- WHEN the client parses it
- THEN it returns the same normalized list shape as it would for
  `{ sites: [...] }`

### Requirement: Cursor Pagination via nextToken

Any client method wrapping a paginable endpoint MUST accept and pass
through a `nextToken` cursor, and MUST return the response's `nextToken`
for the caller to continue.

#### Scenario: nextToken round-trips

- GIVEN a paginated response containing `nextToken: "abc"`
- WHEN the client returns its result
- THEN the result includes `nextToken: "abc"` for the caller to pass to the
  next call

### Requirement: Domain-Specific Address Shapes

The client MUST address `code` endpoints by GitHub `{owner}/{repo}`,
distinct from the `{org}/{site}` shape used elsewhere, and MUST NOT accept a
`ref` parameter on snapshot paths, which are pinned to `main`.

#### Scenario: Code endpoint uses owner/repo, snapshot path has no ref

- GIVEN a call to a code-domain method with `owner: "example-owner"` and
  `repo: "example-repo"`, and separately a call to a snapshot method
- WHEN the client builds each request URL
- THEN the code path is keyed by `owner`/`repo` (not `org`/`site`), and the
  snapshot path is fixed under `main` with no `ref` argument accepted
