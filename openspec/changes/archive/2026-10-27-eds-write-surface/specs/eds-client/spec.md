# Delta for eds-client

## MODIFIED Requirements

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

## ADDED Requirements

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
