// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.7): `readEnvelope()` is the ONLY reader of
// `response.status` (design.md, Decision 1). fetch-reject, an unparseable
// body, and a JSON body with neither `data` nor `errors` all map to
// `AcoTransportError`. Critically: a raw 429 with NO `errors[]` array is
// `AcoTransportError`, NEVER a throttle — asserted in the SAME test as a
// 200-with-throttle-shaped-extension case, so the two can never silently
// drift into being confused with each other.
import { describe, expect, it, vi } from "vitest";
import { createFetchDouble, graphQlErrors } from "../testing/fetch-double.js";
import { AcoOperationError, AcoThrottledError, AcoTransportError } from "./errors.js";
import { createAdminTransport, createMerchandisingTransport, type GraphQlOperation } from "./http.js";

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

function stubTokenProvider(token: string) {
  return {
    domain: "aco",
    getToken: async () => ({ kind: "static" as const, value: token }),
    invalidate: () => undefined,
    describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: "ACO_TOKEN", configPath: "/dev/null", reason: "not found" }),
  };
}

function namedOperation<T>(name: string, parse: (data: unknown) => T): GraphQlOperation<"admin", T> {
  return { track: "admin" as const, document: `query ${name} { ${name.toLowerCase()} }`, parse: parse as GraphQlOperation<"admin", T>["parse"] };
}

describe("readEnvelope() via AdminTransport.execute — the only reader of status", () => {
  it("a rejected fetch maps to AcoTransportError(reason: fetch-rejected)", async () => {
    const transport = createAdminTransport({
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });

    const error = await transport.execute(namedOperation("ListPolicies", (d) => d)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcoTransportError);
    expect((error as AcoTransportError).reason).toBe("fetch-rejected");
  });

  it("an unparseable response body maps to AcoTransportError(reason: unparseable-body)", async () => {
    const transport = createAdminTransport({
      fetch: (async () => new Response("not json{{{", { status: 200 })) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });

    const error = await transport.execute(namedOperation("ListPolicies", (d) => d)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcoTransportError);
    expect((error as AcoTransportError).reason).toBe("unparseable-body");
  });

  it("a JSON body with neither data nor errors maps to AcoTransportError(reason: no-graphql-envelope)", async () => {
    const transport = createAdminTransport({
      fetch: (async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });

    const error = await transport.execute(namedOperation("ListPolicies", (d) => d)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcoTransportError);
    expect((error as AcoTransportError).reason).toBe("no-graphql-envelope");
  });

  it("a raw 429 with no errors[] is AcoTransportError, never a throttle — proven alongside a 200 throttle-shaped case", async () => {
    const rawStatusTransport = createAdminTransport({
      fetch: (async () => new Response(null, { status: 429 })) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });
    const throttleShapedTransport = createAdminTransport({
      fetch: (async () =>
        new Response(JSON.stringify({ data: null, errors: [{ message: "slow down", extensions: { classification: "too-many-requests" } }] }), {
          status: 200,
        })) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });

    // The raw 429 (no envelope at all — the body is empty) is a transport
    // failure, not a throttle: `response.status` alone can never produce
    // AcoThrottledError.
    await expect(rawStatusTransport.execute(namedOperation("ListPolicies", (d) => d))).rejects.toBeInstanceOf(AcoTransportError);
    await expect(rawStatusTransport.execute(namedOperation("ListPolicies", (d) => d))).rejects.not.toBeInstanceOf(AcoThrottledError);
    // A 200 whose GraphQL envelope carries throttle-shaped extensions IS a
    // throttle, entirely independent of the HTTP status that carried it.
    await expect(throttleShapedTransport.execute(namedOperation("ListPolicies", (d) => d))).rejects.toBeInstanceOf(AcoThrottledError);
  });
});

describe("AdminTransport wiring", () => {
  it("sends the resolved token and api key through buildAdminHeaders, and returns operation.parse's result", async () => {
    const calls: Array<{ headers: Headers; body: string }> = [];
    const transport = createAdminTransport({
      fetch: (async (_url: unknown, init?: RequestInit) => {
        calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        return new Response(JSON.stringify({ data: { policies: [] } }), { status: 200 });
      }) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-admin-bearer"),
      apiKey: "test-only-api-key",
    });

    const result = await transport.execute(namedOperation("ListPolicies", (data) => ({ parsed: true, data })));

    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer test-only-admin-bearer");
    expect(calls[0]?.headers.get("x-api-key")).toBe("test-only-api-key");
    expect(result).toEqual({ parsed: true, data: { policies: [] } });
  });
});

describe("MerchandisingTransport wiring", () => {
  it("has no tokenProvider to read — an unprotected call carries no Authorization header", async () => {
    const calls: Array<{ headers: Headers }> = [];
    const transport = createMerchandisingTransport({
      fetch: (async (_url: unknown, init?: RequestInit) => {
        calls.push({ headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ data: { productSearch: { totalCount: 0 } } }), { status: 200 });
      }) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://merch.aco.example/graphql",
    });
    const operation: GraphQlOperation<"merchandising", unknown> = {
      track: "merchandising",
      document: "query SearchCatalog($phrase: String) { productSearch(phrase: $phrase) { totalCount } }",
      parse: (d) => d,
    };

    await transport.execute(operation, { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US" });

    expect(calls[0]?.headers.get("AC-View-ID")).toBe("acv-demo-outdoor-gear-eu");
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
  });

  it("resolves a configured catalogViewAccessToken supplier exactly once per request", async () => {
    const supplier = vi.fn(async () => "test-only-view-access-token");
    const calls: Array<{ headers: Headers }> = [];
    const transport = createMerchandisingTransport({
      fetch: (async (_url: unknown, init?: RequestInit) => {
        calls.push({ headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ data: { productSearch: { totalCount: 0 } } }), { status: 200 });
      }) as typeof globalThis.fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://merch.aco.example/graphql",
      catalogViewAccessToken: supplier,
    });
    const operation: GraphQlOperation<"merchandising", unknown> = {
      track: "merchandising",
      document: "query SearchCatalog($phrase: String) { productSearch(phrase: $phrase) { totalCount } }",
      parse: (d) => d,
    };

    await transport.execute(operation, { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US" });

    expect(supplier).toHaveBeenCalledTimes(1);
    expect(calls[0]?.headers.get("AC-Catalog-View-Access-Token")).toBe("test-only-view-access-token");
  });
});

describe("end-to-end 200-with-errors trap, through the fetch double (tasks.md 1.18)", () => {
  it("the fetch double's route really is a 200/ok response, AND the real client still rejects with a typed AcoError", async () => {
    const { fetch } = createFetchDouble({ "POST /graphql ListPolicies": graphQlErrors([{ message: "Internal error" }]) });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/graphql",
      tokenProvider: stubTokenProvider("test-only-bearer"),
    });

    const rawResponse = await fetch("https://admin.aco.example/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "query ListPolicies { policies { policyId } }" }),
    });
    expect(rawResponse.status).toBe(200);
    expect(rawResponse.ok).toBe(true);

    await expect(transport.execute(namedOperation("ListPolicies", (d) => d))).rejects.toBeInstanceOf(AcoOperationError);
  });
});
