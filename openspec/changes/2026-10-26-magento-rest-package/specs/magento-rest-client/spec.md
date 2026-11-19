# Spec: magento-rest-client

## Requirement: Path Construction
Every REST path the package sends MUST be built with `restPath`, which MUST encode
each interpolated value as exactly one path segment.

#### Scenario: a SKU tries to traverse
- GIVEN a SKU of `a/../../customers`
- WHEN a product is requested
- THEN the request path MUST be `/products/a%2F..%2F..%2Fcustomers` and no request MUST be sent to `/customers`

#### Scenario: an all-dots segment
- GIVEN a value of `..`
- WHEN it is interpolated
- THEN it MUST be encoded as `%2E%2E`

## Requirement: Search Criteria
`buildSearchCriteria` MUST encode every value as data and MUST validate every name that becomes part of a key.

#### Scenario: a value contains `&`
- GIVEN a filter value `x&searchCriteria[pageSize]=9999`
- WHEN the query is built
- THEN it MUST appear as one value and the page size MUST remain the bounded default

#### Scenario: a field could break out of its key
- GIVEN a sort field `id]&x[`
- WHEN the query is built
- THEN it MUST be rejected

#### Scenario: no input
- WHEN the query is built with no input
- THEN it MUST still carry an explicit `pageSize` between 1 and 100

## Requirement: Bounded Pagination
`getAllPages` MUST stop at a page cap (default 10, ceiling 50) and MUST report `truncated: true` when the cap ended the walk before Magento ran out of records.

## Requirement: Failures
A failed request MUST raise a classified error carrying Magento's message template only. It MUST NOT carry the response body, the `parameters` object, or any credential.

#### Scenario: parameters hold a value
- GIVEN a 404 whose `parameters` contain an email
- THEN the error message MUST NOT contain that email

#### Scenario: a non-JSON body
- GIVEN a 502 with an HTML body
- THEN the message MUST be `Magento REST request failed with HTTP 502.`

## Requirement: Retry
A GET MUST be retried on 429, 502, 503, 504 and on a network failure, up to three attempts. A POST, PUT or DELETE MUST NOT be retried.

## Requirement: Transport Security
The base URL MUST be `https`, except that `http` MAY be used for `localhost`, `127.0.0.1` and `[::1]`. A URL with embedded credentials MUST be refused. Nothing under `src/` SHALL reference the means of disabling TLS verification.

## Requirement: Client Purity
`client/` MUST NOT read the environment, write output, or exit the process.
