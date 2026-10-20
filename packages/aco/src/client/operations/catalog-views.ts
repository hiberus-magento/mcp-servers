// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListCatalogViews` — `Q_VIEWS` (exploration.md). Admin track. Backs
// `aco_list_catalog_views`, `cli.ts`'s `view list`/`view delete`/`view
// prune`, and `provision`'s catalog-view step.
//
// RENAMED FROM `channels.ts`. The admin schema renamed this query and its
// fields after this package was written, and the old document fails against
// the live service with `Cannot query field "channels" on type "Query"`
// (`GRAPHQL_VALIDATION_FAILED`). Introspection is disabled server-side, so
// the replacement was recovered by probing and then EXECUTED against the
// live admin endpoint — the document below is that exact verified document,
// not a guess:
//
//   channels   -> catalogViews        channelId -> viewId
//   scopes     -> sources             layers[].scope -> layers[].source
//
// `sources` has exactly one confirmed subfield, `locale`; `layers[].source`
// has `locale` and `layer`. Nothing else probed under either was accepted.
// Do not add a field here without executing it first: every name in this
// document is load-bearing, and a single unknown one fails the WHOLE query,
// not just that field.
//
// The old vocabulary is deliberately gone from this module rather than kept
// as an alias — leaving it is how the next reader re-learns the wrong model.
// The write-side counterparts in `mutations.ts` moved with it and are now
// `createCatalogView`/`updateCatalogView`/`deleteCatalogView`, captured from
// the ACO Admin UI's own successful requests. (The wording here avoids the
// `mutation` + space token that `mutations.test.ts` scans `client/**` for;
// that scan is deliberately crude, and the comment bends around it rather
// than the reverse.)
//
// `draft` is selected because it is the ONLY thing that makes a view a
// draft. This package used to decide that with `/_draft$/i` over the view's
// NAME, in `aco_list_catalog_views` and — far worse — in `view prune`,
// which DELETES what it decides is a draft. The heuristic is wrong in both
// directions, and `draft` was verified readable here against the live
// service.
import type { AdminTransport } from "../http.js";
import { parseListCatalogViewsResult, type ListCatalogViewsResult } from "../types.js";

const LIST_CATALOG_VIEWS_DOCUMENT = `query ListCatalogViews {
  catalogViews {
    viewId
    name
    defaultPriceBookId
    policyIds
    protectionEnabled
    allowedPriceBookIds
    restrictedAccessKeyIds
    draft
    sources {
      locale
    }
    layers {
      order
      source {
        locale
        layer
      }
    }
  }
}`;

export async function listCatalogViews(transport: AdminTransport): Promise<ListCatalogViewsResult> {
  return transport.execute({
    track: "admin",
    document: LIST_CATALOG_VIEWS_DOCUMENT,
    parse: (data) => parseListCatalogViewsResult(data, "ListCatalogViews"),
  });
}
