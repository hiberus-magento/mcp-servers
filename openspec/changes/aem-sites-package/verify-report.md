# Verify report: aem-sites-package

Live run on 2026-10-28 against a non-production AEM as a Cloud Service author connected to an
Edge Delivery Services site, through the built `hiberus-aem-sites-mcp` over stdio (the same
JSON-RPC a client sends). Every write was a plan shown to the user, an explicit yes, then
`aem_apply` with that plan's token. Real paths and hosts are not recorded here (public
repository); the shapes are.

## Reads

| Tool | Result |
|---|---|
| `aem_list_environments` | env, origin, token source `file`; no token in the output |
| `aem_check_auth` | `ok`, HTTP 200 (QueryBuilder probe) |
| `aem_list_pages` | site tree, pagination (`total`, `more`), `childrenOnly` |
| `aem_get_page`, `aem_get_replication_status` | properties and publish state |
| `aem_get_sheet` | the EDS `metadata` sheet: columns `url`, `Robots`; row `/**` |
| `aem_get_page_tree` | component tree depth 1–3 |
| `aem_list_templates` | templates under a `/conf` root |

## Writes, on one test page

| Step | Author | EDS preview / live |
|---|---|---|
| — (start) | page exists, never replicated | 404 / 404 |
| `page.set-robots` `noindex, nofollow` | `robots` written, HTTP 200; re-plan `no-changes` | unchanged |
| `page.publish` both | Activate recorded | 200 / 200, `<meta name="robots" content="noindex, nofollow">` |
| `page.set-robots` `noindex, noarchive` + `page.publish` | written, replicated | 200 / 200, `<meta name="robots" content="noindex, noarchive">` |
| `page.unpublish` both | Deactivate recorded | 404 / 404 |
| `page.copy` | copy created, same content, no replication state | — |
| `page.move` | copy renamed, old path gone | — |
| `page.delete` | moved copy gone; original untouched | — |
| `aem_apply` with a forged token | `unknown-token`, nothing written | — |

The `noarchive` step exists because the site's metadata sheet already set `noindex, nofollow`
on `/**`: a value only the page could produce proves the page field is rendered, and that it wins
over the sheet.

## Defects found and fixed during the run

1. **Per-page robots field**: XWalk's `page-metadata` model stores `robots` as text on
   `jcr:content`; `cq:robotsTags` is not used. `page.set-robots` now writes `robots`.
2. **Preview replication is not recorded by AEM**: only the publish agent leaves
   `cq:lastReplication*` / `*_publish`. Preview is reported as `not-recorded-by-aem`.
3. **QueryBuilder `path` matches by prefix** with `path.self=true`: a sibling sharing the
   name prefix was returned. Hits are now re-checked as the root or a real descendant.
4. **Replication action without a date** (inherited by a page created as a copy) made a
   never-published page look published. An action without its date is now ignored.

## Not yet run live

`page.set-properties`, `page.create`, `sheet.upsert-row`, `sheet.delete-row` (applied). Their
tools keep the "Not verified against a live service" marker for those kinds.
