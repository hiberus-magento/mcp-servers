# Tasks: aem-sites-component-properties

## Phase 1: Client and guard

- [x] 1.1 `assertComponentPath` (paths.test.ts): page inside the write roots, `/jcr:content/` plus at least one node, plain segments.
- [x] 1.2 `assertWritableComponentProperty` (properties.test.ts): structural ban, no namespace, no UE binding field.
- [x] 1.3 `buildSetComponentProperties` (builders.test.ts).
- [x] 1.4 `readComponent` (reads.test.ts): own properties of one node, `undefined` on 404.

## Phase 2: Plan / apply

- [x] 2.1 Kind `component.set-properties` in the schema and plan builder; `component` state check in apply.
- [x] 2.2 Token matrix case; plan contents (changed fields only, no-op, not-found, Live Copy warning).

## Phase 3: Docs and manifest

- [x] 3.1 aem_plan description, package README, specs `aem-sites-mcp` and `aem-sites-client`.

## Phase 4: Live validation

- [x] 4.1 Through the MCP on a non-production author: set one block field, read it back, remove it, read it back.
  - 2026-10-29, a non-production author, local build of `local/mcp-integration`. On the cart block of a template page (`<root>/templates/cart/jcr:content/root/section/block`): set `checkout-url` and `start-shopping-url` (apply 200), and on the mini-cart template's block set `cart-url`, `checkout-url` and `start-shopping-url` (apply 200); `aem_get_page_tree` read the new values back. Set the test field `zz-mcp-check` (apply 200, read back), then removed it with `remove` (apply 200, read back: absent, other fields unchanged).
  - Observed: after a write, AEM rewrites the node's `modelFields` from the current XWalk model (typed entries such as `checkout-url@text`, plus fields added to the model since the block was inserted). The request only carries the planned fields and `_charset_`, so this is the author, not the builder; the plan does not list it.
