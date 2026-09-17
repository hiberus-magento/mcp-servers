# Delta for mcp-conformance

## MODIFIED Requirements

### Requirement: Shared Synthetic Catalog-Views Fixture

The suite MUST own a shared `catalog-views.csv` fixture, populated
exclusively with synthetic vertical, store-view, and locale values, for
use as a cross-domain integration fixture. The fixture's header MUST be
`vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency`. The
`ac_view_id`, `ac_price_book_id`, and `currency` columns MUST be additive:
no existing column (`vertical`, `site`, `locale`, `view_code`) MAY be
renamed, reordered ahead of its original position, or dropped, so every
existing consumer keeps working unmodified against the migrated fixture.

(Previously: header was `vertical,site,locale,view_code`, with no
ACO-provisioned columns; the fixture could not carry the `aco`→`eds`
hand-off.)

#### Scenario: Fixture contains no real identifiers

- GIVEN the committed `catalog-views.csv`
- WHEN its contents are inspected
- THEN every row uses synthetic organization, site, and domain values, and
  no real customer identifier appears

#### Scenario: Fixture is consumable by multiple domain packages

- GIVEN two domain packages that both need catalog-view test data
- WHEN each imports the shared fixture from `mcp-testing`
- THEN neither package maintains its own duplicate copy

#### Scenario: Migration is additive and existing consumers keep working

- GIVEN the migrated fixture and `eds`'s existing test suite, which reads
  only `vertical`, `site`, `locale`, and `view_code`
- WHEN `eds`'s suite runs against the migrated fixture
- THEN it passes unmodified, proving no existing column was renamed or
  removed

#### Scenario: Fixture carries the ACO-to-EDS hand-off columns

- GIVEN the migrated `catalog-views.csv`
- WHEN its header row is parsed
- THEN it contains `ac_view_id`, `ac_price_book_id`, and `currency` in
  addition to the four original columns

#### Scenario: A provisioned row is the same row both domains read

- GIVEN a fixture-fed `aco`-side function that writes an `ac_view_id` for
  a synthetic `(vertical, site)` pair
- WHEN the `eds`-side config path reads `catalog-views.csv` for that same
  `(vertical, site)` pair
- THEN it reads the exact `ac_view_id` value the `aco`-side function wrote,
  proving one shared row rather than two independently-parsed copies
