// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.18): ACO's fetch double keys routes on
// `"<METHOD> <pathname> <operationName>"` — unlike EDS's
// `"<METHOD> <pathname><search>"`, because every ACO request is a `POST` to
// one of two fixed paths (design.md, Decision 5), so pathname alone cannot
// discriminate. Deliberately self-contained: this module lives outside
// `client/`, so it must never deep-import from it (the client-boundary
// eslint rule forbids exactly that) — the end-to-end proof that a
// 200-with-errors[] route still rejects through the real client lives in
// `client/http.test.ts` instead, which is allowed to import both this
// module and its sibling client files.
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlErrors, graphQlOk, graphQlPartial, transportFailure } from "./fetch-double.js";

describe("fetch-double route keying", () => {
  it("keys routes on METHOD, pathname, AND the posted operation name — not pathname alone", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql ListPolicies": graphQlOk({ policies: [{ policyId: "restricted-catalog", name: "Restricted Catalog" }] }),
    });

    const response = await fetch("https://admin.aco.example/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "query ListPolicies { policies { policyId } }" }),
    });
    const body = (await response.json()) as { data: { policies: unknown[] } };

    expect(calls).toHaveLength(1);
    expect(body.data.policies).toHaveLength(1);
  });

  it("throws when no route matches the operation name, naming the missing key", async () => {
    const { fetch } = createFetchDouble({ "POST /graphql ListPolicies": graphQlOk({ policies: [] }) });

    await expect(
      fetch("https://admin.aco.example/graphql", { method: "POST", body: JSON.stringify({ query: "query ListCatalogViews { catalogViews { viewId } }" }) }),
    ).rejects.toThrow(/ListCatalogViews/);
  });

  it("two different operations posted to the same pathname are routed independently", async () => {
    const { fetch } = createFetchDouble({
      "POST /graphql ListPolicies": graphQlOk({ policies: [] }),
      "POST /graphql ListCatalogViews": graphQlOk({ catalogViews: [{ viewId: "acv-demo-outdoor-gear-eu" }] }),
    });

    const catalogViewsResponse = await fetch("https://admin.aco.example/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "query ListCatalogViews { catalogViews { viewId } }" }),
    });
    const body = (await catalogViewsResponse.json()) as { data: { catalogViews: unknown[] } };

    expect(body.data.catalogViews).toHaveLength(1);
  });
});

describe("response helpers", () => {
  it("graphQlOk produces a 200 body with only data, no errors key", () => {
    const route = graphQlOk({ policies: [] });

    expect(route.status).toBe(200);
    expect(route.body).toEqual({ data: { policies: [] } });
  });

  it("graphQlErrors produces a 200 body whose data is null and errors is non-empty", () => {
    const route = graphQlErrors([{ message: "Internal error" }]);

    expect(route.status).toBe(200);
    expect(route.body).toEqual({ data: null, errors: [{ message: "Internal error" }] });
  });

  it("graphQlPartial carries both data and errors in the same body", () => {
    const route = graphQlPartial({ policies: [] }, [{ message: "one field failed" }]);

    expect(route.status).toBe(200);
    expect(route.body).toEqual({ data: { policies: [] }, errors: [{ message: "one field failed" }] });
  });

  it("transportFailure produces a response with no GraphQL envelope at all, at the given status", () => {
    const route = transportFailure(503);

    expect(route.status).toBe(503);
    // A plain string body, not `{ data, errors }` — there is no GraphQL
    // envelope to find here, which is the whole point of this helper.
    expect(typeof route.body).toBe("string");
  });
});
