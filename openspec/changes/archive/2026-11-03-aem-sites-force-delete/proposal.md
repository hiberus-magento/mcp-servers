# Proposal: aem-sites-force-delete — delete pages that are still referenced

## Intent

Rebuilding a site tree means deleting whole stores and language masters. `page.delete` sends
`force=false`, so the author answers `412 Precondition Failed` whenever anything references a page
of the subtree: a navigation link, a block's configured URL, a Live Copy of it, and, for a
subtree, links between its own pages. A real store has hundreds of those, so today it can only be
deleted from the Sites console (*Force Delete*). The failure is also opaque: the author explains
the 412 in an HTML status page that the client drops, so the tool reports a bare `HTTP 412`.

Observed on 2026-10-29 on a non-production author: deleting a copied `templates` folder and a demo
page answered 412 until every referencing field was removed by hand; deleting three store folders
and a language master answered 412 with no way forward through the MCP.

## Scope

### In Scope

- `page.delete` takes an optional `force: boolean` (default `false`). With `true` the request sends
  `force=true`, as the console's *Force Delete* does.
  - The plan says so in its summary and warns that links and Live Copies pointing to the deleted
    pages are left broken.
  - The published-content guard is unchanged: `force` never deletes a page whose last publish
    action is `Activate`.
- A delete without `force` that fails with 412 names the cause and the way out (plan again with
  `force: true`).
- `page.delete` takes an optional `allowPublished: boolean` for pages the author still marks as
  published but refuses to unpublish. Observed on 2026-10-29: a language master path that no Edge
  Delivery Services site maps answered every unpublish with 400 ("the technical account is
  missing the following permissions" on an unrelated site), so its two pages marked `Activate`
  blocked the delete of the whole tree. The plan lists them and warns that pages really live stay
  orphaned on publish; the rejection without it names it only as the fallback after a refused
  unpublish.
- Every error built from an author response keeps the message of Sling's HTML status page
  (`<div id="Message">`), when there is one, instead of dropping the whole body as HTML. A login
  page still fails as an authentication error.

### Out of Scope

- Listing the references of a page at plan time (`reference.json`); not explored yet.
- Deleting published pages without an explicit `allowPublished: true` in the plan.

## Recorded decision this change modifies

`aem-sites-mcp` used `{ kind: "page.delete", path, force: true }` as its example of a field a kind
does not take. `force` becomes a field `page.delete` takes; the scenario moves to another kind.

## Risks

| Risk | Mitigation |
|---|---|
| A forced delete breaks links in pages that stay | Opt-in per plan, stated in the summary and in a warning the user confirms |
| An agent skips the unpublish with `allowPublished` | The rejection offers it only after a refused unpublish; the plan names every page left orphaned |
| An agent forces by default | `force` is never implied; the 412 hint is the only place that suggests it, after a refused delete |
| A status page leaks something sensitive | Only the text of `#Message`, whitespace-collapsed and capped at the existing detail length |

## Success Criteria

- [ ] `page.delete` with and without `force` passes the token matrix.
- [ ] Builder, schema, plan, apply and HTTP tests for the new field, the 412 hint and the message
      extraction.
- [ ] Validated on a non-production author: a referenced subtree deleted with `force: true`.
