# Tasks: aem-sites-force-delete

## Phase 1: Client

- [x] 1.1 `buildDeletePage` takes `force` and sends `force=true|false` (builders.test.ts).
- [x] 1.2 `AemStatusError` keeps the Sling status message of an HTML error body (http.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `force` in the `page.delete` schema branch; summary and warning when forced; published guard unchanged.
- [x] 2.2 A step can carry a hint per HTTP status; a 412 on an unforced delete appends it to the failure message.
- [x] 2.3 Token matrix case for a forced delete.

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, package README, specs `aem-sites-mcp` and `aem-sites-client`.

## Phase 4: Live validation

- [ ] 4.1 Through the MCP on a non-production author: a subtree that answers 412 without `force` deleted with `force: true`.
