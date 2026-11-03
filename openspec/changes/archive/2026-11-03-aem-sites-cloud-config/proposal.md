# Proposal: aem-sites-cloud-config — set a page's Cloud Configuration

## Intent

On an Edge Delivery Services author, a page's `cq:conf` (the Cloud Configuration of its page
properties) decides which `/conf` tree the page and every page below it use, and with it the Edge
Delivery Services site the author publishes them to. A store recreated as a new page loses it and
inherits its parent's, so every publish goes to another site. Observed on 2026-10-29 on a
non-production author: three recreated store pages had no `cq:conf`; every publish below them
answered 400 ("the technical account is missing the following permissions" on an unrelated site),
while the stores still untouched carried `cq:conf: /conf/<site>/<store>`. The page-property
allowlist refused `cq:conf`, so only the Sites console could fix it.

## Scope

### In Scope

- `cq:conf` joins the built-in page-property allowlist and the projected page fields.
- Value: a plain path below `/conf` (segments of letters, digits, `_` and `-`); anything else is
  `invalid-value`.
- The plan reads `<conf>.json` and rejects `not-found` when the node does not exist.
- A warning on every plan that changes it: it decides the Edge Delivery Services site and the
  templates of the whole subtree.

### Out of Scope

- Writing anything under `/conf`.
- Checking which site a configuration names (the `/conf` content is not read).

## Risks

| Risk | Mitigation |
|---|---|
| A typo rebinds a subtree to another configuration | Existing nodes only, shown before/after, warning the user confirms |
| A crafted value reaches outside `/conf` | Closed path grammar: no `..`, no selectors, no extension |

## Success Criteria

- [ ] Guard and plan tests for the grammar, the existence check and the warning.
- [ ] Validated on a non-production author: a recreated store bound to its site, then published.
