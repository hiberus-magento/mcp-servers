// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.12): `client/index.ts` is the only public surface
// (design.md, Decision 2). The factory wires the admin and merchandising
// transports, each with its own track-scoped rate limiter (Phase 1), and a
// retry loop reading each operation's `idempotent` flag (design.md,
// Decision 4) — a retryable failure on a query is retried, the identical
// failure on a mutation is not. The runtime-exported surface is exactly the
// error classes and the factory; result types are compile-time only.
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlErrors, graphQlOk } from "../testing/fetch-double.js";
import * as clientModule from "./index.js";
import { createAcoClient } from "./index.js";

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

function stubTokenProvider() {
  return {
    domain: "aco",
    getToken: async () => ({ kind: "static" as const, value: "test-only-bearer" }),
    invalidate: () => undefined,
    describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: "ACO_TOKEN", configPath: "/dev/null", reason: "not found" }),
  };
}

function makeClient(routes: Record<string, unknown>, sleepSpy?: (ms: number) => Promise<void>) {
  const { fetch, calls } = createFetchDouble(routes as never);
  const client = createAcoClient({
    fetch,
    now: FIXED_NOW,
    sleep: sleepSpy ?? NOOP_SLEEP,
    adminBaseUrl: "https://admin.aco.example/admin/graphql",
    merchandisingBaseUrl: "https://merch.aco.example/graphql",
    tokenProvider: stubTokenProvider(),
    random: () => 0,
  });
  return { client, calls };
}

describe("createAcoClient — wiring", () => {
  it("wires the admin transport, so a read operation succeeds end to end", async () => {
    const { client } = makeClient({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId: "pol-demo-1", name: "outdoor-gear-discount" }] }) });

    const result = await client.policies.listPolicies();

    expect(result.policies).toEqual([{ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: undefined, actions: undefined }]);
  });

  it("wires the merchandising transport, so an unprotected search succeeds with no credential", async () => {
    const { client, calls } = makeClient({ "POST /graphql SearchCatalog": graphQlOk({ productSearch: { total_count: 0, items: [], facets: [] } }) });

    // CHANGED DELIBERATELY: `phrase` is now required on SearchCatalogOptions —
    // `$phrase` is `String!`, and an omitted variable is a server-side
    // validation error, not an "everything" search.
    await client.search.searchCatalog({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "tent" });

    expect(calls[0]?.headers["authorization"]).toBeUndefined();
  });

  it("retries a throttled QUERY (idempotent by default) and returns the eventual success", async () => {
    const sleeps: number[] = [];
    const { client, calls } = makeClient(
      {
        "POST /admin/graphql ListPolicies": [
          graphQlErrors([{ message: "slow down", extensions: { classification: "too-many-requests" } }]),
          graphQlOk({ policies: [] }),
        ],
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );

    const result = await client.policies.listPolicies();

    expect(result.policies).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("never retries a throttled MUTATION — idempotent: false stops it at the first failure", async () => {
    const { client, calls } = makeClient({
      "POST /admin/graphql UpdatePolicy": [graphQlErrors([{ message: "slow down", extensions: { classification: "too-many-requests" } }]), graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } })],
    });

    // CHANGED DELIBERATELY: the input used to be `{ policyId, enabled }`.
    // `UpdatePolicyRequest` has no `enabled` member — the mutation carries
    // the whole policy (`operations/mutations.ts`). What this test proves —
    // a throttled mutation is never replayed — is unchanged.
    await expect(client.policies.updatePolicy({ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [] })).rejects.toThrow();

    expect(calls).toHaveLength(1);
  });
});

describe("createAcoClient — raw escape hatch (backs the CLI's api query, Phase 4)", () => {
  it("queryAdmin passes an arbitrary document/variables straight through the admin transport", async () => {
    const { client } = makeClient({ "POST /admin/graphql RawProbe": graphQlOk({ scopes: [{ locale: "en_US" }] }) });

    const result = await client.raw.queryAdmin("query RawProbe { scopes { locale } }");

    expect(result).toEqual({ scopes: [{ locale: "en_US" }] });
  });

  it("queryMerchandising passes context through and needs no credential for an unprotected view", async () => {
    const { client, calls } = makeClient({ "POST /graphql RawMerchProbe": graphQlOk({ productSearch: { total_count: 1 } }) });

    const result = await client.raw.queryMerchandising("query RawMerchProbe { productSearch { total_count } }", undefined, {
      viewId: "acv-demo-outdoor-gear-eu",
      locale: "en_US",
    });

    expect(result).toEqual({ productSearch: { total_count: 1 } });
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
  });
});

describe("client/index.ts — exported runtime surface", () => {
  it("exports exactly the error classes and the factory", () => {
    expect(Object.keys(clientModule).sort()).toEqual(
      ["AcoError", "AcoOperationError", "AcoSchemaMismatchError", "AcoThrottledError", "AcoTransportError", "AdminScopeError", "CatalogViewAccessError", "createAcoClient"].sort(),
    );
  });
});
