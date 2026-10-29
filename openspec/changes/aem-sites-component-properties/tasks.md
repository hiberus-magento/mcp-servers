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

- [ ] 4.1 Through the MCP on a non-production author: set one block field, read it back, remove it, read it back.
