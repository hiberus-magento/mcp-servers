# AEM Sites Client Specification (delta: ADDED)

## Purpose

Defines `packages/aem-sites/src/client/`: pure, typed operations against one AEM as a Cloud
Service author. The client never reads environment variables or credential files; it receives a
`TokenProvider` and an author origin.

## ADDED Requirements

### Requirement: Closed Operation Set

The client MUST expose only named operations (`queryPages`, `readPage`, `readSheet`,
`readReplicationStatus`, `listTemplates`, `readPageTree`, `buildSetProperties`, `buildSheetUpsert`,
`buildSheetDeleteRow`, `buildReplicate`, `buildWcmCommand`, `send`). There SHALL be no function
that issues a request to a caller-supplied URL or with caller-supplied form field names.

#### Scenario: Purity

- GIVEN the client's public surface (`client/index.ts`)
- WHEN its exports are enumerated in a test
- THEN no export accepts a raw URL or raw form pairs

### Requirement: Builders Are Pure and Guarded

Every `build*` function MUST be pure (no network), MUST run the write guard and MUST return a
`PlannedRequest { method, path, form }` or throw a named guard error.

#### Scenario: Guard runs before any byte is built

- GIVEN a builder input with a path outside the write roots
- WHEN the builder is called
- THEN it throws `PathOutsideWriteRootsError` and returns nothing

### Requirement: CSRF on Every POST

`send` MUST obtain a CSRF token from `/libs/granite/csrf/token.json` (cached at most 60 s per
author) and attach it as `CSRF-Token` to every POST.

#### Scenario: CSRF expired mid-batch

- GIVEN a cached CSRF token rejected with 403
- WHEN `send` retries
- THEN it refreshes the CSRF token once and resends the identical request

### Requirement: Field-Proven Retry Policy

`send` MUST retry `409` after 1 s, 2 s and 4 s; MUST retry `400` on `/bin/replicate` once after 3 s;
MUST NOT retry `401`; and MUST back off on `429`/`5xx` up to 3 times honouring `Retry-After`.
Retries MUST resend identical bytes.

#### Scenario: Sheet just created

- GIVEN a POST to a sheet's `jcr:content` answered 409 then 200
- WHEN `send` runs
- THEN it returns the 200 result after one 1 s wait

### Requirement: Projected Reads

Read operations MUST project responses field by field from named allowlists; an unknown property
returned by the author MUST NOT appear in `JSON.stringify` of the result.

#### Scenario: Extra property

- GIVEN a `jcr:content.1.json` response with an extra property `acme:internalNote`
- WHEN `readPage` returns
- THEN the serialized result does not contain `acme:internalNote`

### Requirement: Host Pinning

The author origin MUST fullmatch `https://author-p\d+-e\d+\.adobeaemcloud\.com`; the bearer MUST be
sent with `redirect: "manual"` and a 3xx MUST surface as `AemAuthError`.

#### Scenario: Non-author host

- GIVEN an origin `https://example-domain.invalid`
- WHEN the client is constructed
- THEN construction throws `InvalidAuthorOriginError`
