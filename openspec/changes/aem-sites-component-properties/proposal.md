# Proposal: aem-sites-component-properties — edit a component's fields

## Intent

Rebuilding a site tree leaves blocks whose fields point into the tree they were copied from: a
cart block's `checkout-url` still names a page of the source language master, a template page's
links name a page of one site. `page.set-properties` cannot fix them: it writes only the page's own
`jcr:content`, and a block's fields live one or more nodes below it
(`jcr:content/root/section/block`). The only way left is an author in Universal Editor, field by
field. This change adds one guarded operation, under the same plan/apply contract as every other
kind, that edits the fields of one existing component node.

## Scope

### In Scope

- `component.set-properties` — `{ path, set?, remove? }` where `path` is a component node:
  `<page>/jcr:content/<node>[/<node>…]`. The page must be inside `AEM_WRITE_ROOTS`; every node
  segment is letters, digits, `_` or `-`; `jcr:content` itself is refused (that is
  `page.set-properties`).
- The plan reads the node (`<path>.json`), sends only the fields whose value changes, and the
  apply re-reads it (a `component` state check), so an edit made in the editor meanwhile makes the
  plan stale.
- The node must exist: the operation edits a component, it never creates one (no
  `not-found` → create fallback).
- Field names: the structural guard of page properties (`@`, a leading `:`, structural and
  bookkeeping names) plus two component rules:
  - no namespaced name (`jcr:…`, `cq:…`, `sling:…`), since authored XWalk fields are plain
    names;
  - not the fields that bind a node to Universal Editor: `name`, `model`, `filter`,
    `modelFields` and `key-value`. Changing `model` or `key-value` would orphan the component in
    the editor.
- A warning on every plan: a component inherited from a Live Copy blueprint is overwritten by the
  next rollout unless its inheritance is cancelled in the editor.

### Out of Scope

- Creating, moving, reordering or deleting components (structure stays an authoring task).
- Cancelling or restoring MSM inheritance (`cq:LiveSyncCancelled`); not explored yet.
- Writing rich text or references to assets beyond plain string values.

## Risks

| Risk | Mitigation |
|---|---|
| A field name changes how Sling or the editor treats the node | Closed structural ban + the UE binding fields above; operators are only emitted by the builder |
| The edit is silently undone by a rollout | Warning on every plan; the agent is told to cancel inheritance in the editor when the page is a Live Copy |
| The node was edited in the editor between plan and apply | `component` state check: a changed node makes the plan stale and nothing is written |

## Success Criteria

- [ ] `component.set-properties` passes the token matrix (forged, expired, reused, stale, echo).
- [ ] Builder and guard tests for the path grammar, the name bans and the value encoding.
- [ ] Validated on a non-production author: one field of a block set and removed, read back after
      each step with `aem_get_page_tree`.
