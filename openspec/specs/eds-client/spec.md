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

Before writing a site configuration, the client MUST perform a `GET` to determine whether the site
already exists, and MUST NOT rely on catching an HTTP `409` as its existence check. Creating a site
MUST send `PUT` only when that `GET` returned `404`, and MUST fail without writing when the site
already exists. Updating a site MUST send `POST` only when that `GET` returned `200`, and MUST fail
without writing when the site does not exist.
(Previously: a single write function always sent `PUT`, for new and existing sites alike.)

#### Scenario: Existing site is detected before the write

- GIVEN a site `acme-demo-site-eu` that already exists
- WHEN the client is asked to create it
- THEN it issues a `GET`, receives `200`, and fails naming the existing site without issuing a
  `PUT`

#### Scenario: Update of an existing site uses POST

- GIVEN a site `acme-demo-site-eu` that exists
- WHEN the client updates its configuration
- THEN it issues a `GET`, then a `POST` to `/config/acme-demo-org/sites/acme-demo-site-eu.json`

#### Scenario: Creation of a new site uses PUT

- GIVEN a site `acme-demo-site-us` that does not exist
- WHEN the client creates it
- THEN it issues a `GET` answered `404`, then a `PUT` to
  `/config/acme-demo-org/sites/acme-demo-site-us.json`

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

### Requirement: Site Lifecycle and Configuration Versions

The client MUST provide: list sites (`GET /config/{org}/sites.json`, normalised per "Tolerant Site
List Response Shape"), delete a site (`DELETE /config/{org}/sites/{site}.json`), list a site's
configuration versions (`GET /config/{org}/sites/{site}/versions.json`), and restore one
(`POST /config/{org}/sites/{site}.json?restoreVersion={id}`).

#### Scenario: Restore targets the version query parameter

- GIVEN version id `v-demo-1` of `acme-demo-site-eu`
- WHEN the client restores it
- THEN it issues `POST /config/acme-demo-org/sites/acme-demo-site-eu.json?restoreVersion=v-demo-1`

### Requirement: robots.txt Read and Write

The client MUST read `GET /config/{org}/sites/{site}/robots.txt` as text and write it with
`POST` to the same path with a `text/plain` content type.

#### Scenario: robots.txt is written as plain text

- GIVEN the content `User-agent: *\nDisallow: /`
- WHEN the client writes it for `acme-demo-site-eu`
- THEN the request is a `POST` with `content-type: text/plain` and exactly that body

### Requirement: Single-Path and Bulk Preview, Live and Index Operations

For preview, live and index the client MUST provide single-path operations
(`POST`/`DELETE /{resource}/{org}/{site}/{ref}/{path}`) and, for preview and live, bulk operations
(`POST /{resource}/{org}/{site}/{ref}/*` with an explicit JSON body carrying `paths` and, for
removal, `delete: true`). Bulk results MUST keep reporting ignored paths per "Bulk Write
Ignored-Path Reporting".

#### Scenario: Bulk unpublish sends delete in the body

- GIVEN two paths to unpublish on `acme-demo-site-eu`
- WHEN the client issues the bulk operation
- THEN it sends `POST /live/acme-demo-org/acme-demo-site-eu/main/*` with a body containing both
  paths and `delete: true`

### Requirement: Cache Purge and Sitemap Rebuild

The client MUST provide cache purge per path (`POST /cache/{org}/{site}/{ref}/{path}`) and sitemap
rebuild (`POST /sitemap/{org}/{site}/{ref}/{path}`), each returning the response as a plain object.

#### Scenario: Purge addresses one path

- GIVEN the path `/products/demo`
- WHEN the client purges it on `acme-demo-site-eu`
- THEN it issues `POST /cache/acme-demo-org/acme-demo-site-eu/main/products/demo`

### Requirement: Code Status, Sync and Delete

The client MUST provide code status (`GET`), sync (`POST`) and delete (`DELETE`) on
`/code/{owner}/{repo}/{ref}/{path}`, keeping the `{owner}/{repo}` address shape required by
"Domain-Specific Address Shapes".

#### Scenario: Code sync is keyed by owner and repo

- GIVEN `owner: "example-owner"`, `repo: "example-repo"` and the path `/scripts/demo.js`
- WHEN the client syncs it
- THEN it issues `POST /code/example-owner/example-repo/main/scripts/demo.js`

### Requirement: Job Listing and Stopping

The client MUST list the jobs of a topic (`GET /job/{org}/{site}/{ref}/{topic}`) and stop a job
(`DELETE /job/{org}/{site}/{ref}/{topic}/{name}`), treating any `2xx` as success.

#### Scenario: Stop addresses the job by topic and name

- GIVEN the job `job-demo-1` on topic `publish`
- WHEN the client stops it on `acme-demo-site-eu`
- THEN it issues `DELETE /job/acme-demo-org/acme-demo-site-eu/main/publish/job-demo-1`

### Requirement: API Key Metadata and Deletion

The client MUST list the organisation's API keys (`GET /config/{org}/apiKeys.json`) returning
metadata only, and delete one (`DELETE /config/{org}/apiKeys/{id}.json`). No client function added
by this change MAY create a key.

#### Scenario: Listing never returns a key value

- GIVEN a list response whose entries carry ids, descriptions, roles and expiry
- WHEN the client returns the list
- THEN no entry contains a key value field
