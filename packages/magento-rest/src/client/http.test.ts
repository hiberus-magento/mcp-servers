// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The transport is the only code that talks to the network. What
// it must guarantee: the token travels only in the Authorization header, a
// failure never carries the response body, a read is retried but a write is
// never replayed, and a plaintext base URL is refused (a Bearer over http is
// a Bearer on the wire).
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createFetchDouble, json } from "../testing/fetch-double.js";
import { MagentoRestError } from "./errors.js";
import { createRestTransport } from "./http.js";

const remedy = { domain: "magento-rest", cliCommand: "hiberus-magento-rest auth token set", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "test" };
const tokenProvider = new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy });

const build = (routes: Parameters<typeof createFetchDouble>[0], baseUrl: string = SYNTHETIC_MAGENTO_BASE_URL) => {
  const double = createFetchDouble(routes);
  const sleeps: number[] = [];
  let clock = 0;
  const transport = createRestTransport({
    fetch: double.fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    baseUrl,
    tokenProvider,
  });
  return { double, sleeps, transport };
};

describe("createRestTransport", () => {
  it("sends the Bearer token and JSON accept header, and returns the parsed body", async () => {
    const { double, transport } = build({ "GET /rest/V1/store/websites": json(200, [{ id: 1 }]) });
    expect(await transport.request({ method: "GET", path: "/store/websites" })).toEqual([{ id: 1 }]);
    expect(double.calls[0]?.headers["authorization"]).toBe(`Bearer ${SYNTHETIC_MAGENTO_TOKEN}`);
    expect(double.calls[0]?.headers["accept"]).toBe("application/json");
  });

  it("appends the query string after the path, and tolerates a trailing slash on the base URL", async () => {
    const { double, transport } = build({ "GET /rest/V1/products": json(200, {}) }, `${SYNTHETIC_MAGENTO_BASE_URL}/`);
    await transport.request({ method: "GET", path: "/products", query: "a=1&b=2" });
    expect(double.calls[0]?.url).toBe(`${SYNTHETIC_MAGENTO_BASE_URL}/products?a=1&b=2`);
  });

  it("sends a JSON body with a content type on a write", async () => {
    const { double, transport } = build({ "POST /rest/V1/orders/7/comments": json(200, true) });
    await transport.request({ method: "POST", path: "/orders/7/comments", body: { statusHistory: { comment: "hi" } } });
    expect(double.calls[0]?.headers["content-type"]).toBe("application/json");
    expect(double.calls[0]?.body).toBe('{"statusHistory":{"comment":"hi"}}');
  });

  it("sends no content type and no body on a read", async () => {
    const { double, transport } = build({ "GET /rest/V1/x": json(200, {}) });
    await transport.request({ method: "GET", path: "/x" });
    expect(double.calls[0]?.headers["content-type"]).toBeUndefined();
    expect(double.calls[0]?.body).toBeUndefined();
  });

  it("throws a classified error that carries neither the response body nor the token", async () => {
    const { transport } = build({
      "GET /rest/V1/orders/1": json(404, { message: "No such entity with %fieldName = %fieldValue", parameters: { fieldValue: "shopper@example-domain" } }),
    });
    const error = await transport.request({ method: "GET", path: "/orders/1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MagentoRestError);
    expect((error as MagentoRestError).kind).toBe("not-found");
    expect(String((error as Error).message)).not.toContain("shopper@example-domain");
    expect(String((error as Error).message)).not.toContain(SYNTHETIC_MAGENTO_TOKEN);
  });

  it("retries a read on 503 with backoff, then succeeds", async () => {
    const { double, sleeps, transport } = build({ "GET /rest/V1/x": [json(503, { message: "busy" }), json(503, { message: "busy" }), json(200, { ok: true })] });
    expect(await transport.request({ method: "GET", path: "/x" })).toEqual({ ok: true });
    expect(double.calls).toHaveLength(3);
    expect(sleeps).toEqual([125, 250]);
  });

  it("gives up after the attempt budget and throws the last failure", async () => {
    const { double, transport } = build({ "GET /rest/V1/x": json(503, { message: "busy" }) });
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "server", status: 503 });
    expect(double.calls).toHaveLength(3);
  });

  it("honors Retry-After (seconds) on a 429", async () => {
    const { sleeps, transport } = build({ "GET /rest/V1/x": [{ status: 429, headers: { "retry-after": "2" }, body: { message: "slow" } }, json(200, {})] });
    await transport.request({ method: "GET", path: "/x" });
    expect(sleeps).toEqual([2000]);
  });

  it("NEVER replays a write on a retryable status", async () => {
    const { double, transport } = build({ "POST /rest/V1/order/7/invoice": json(503, { message: "busy" }) });
    await expect(transport.request({ method: "POST", path: "/order/7/invoice", body: {} })).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });

  it("retries a read after a network failure, and classifies it as transport", async () => {
    let calls = 0;
    const { transport } = build({
      "GET /rest/V1/x": () => {
        calls += 1;
        throw new TypeError("fetch failed");
      },
    });
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "transport" });
    expect(calls).toBe(3);
  });

  it("does not retry a write after a network failure", async () => {
    let calls = 0;
    const { transport } = build({
      "PUT /rest/V1/x": () => {
        calls += 1;
        throw new TypeError("fetch failed");
      },
    });
    await expect(transport.request({ method: "PUT", path: "/x", body: {} })).rejects.toMatchObject({ kind: "transport" });
    expect(calls).toBe(1);
  });

  it("does not retry a 4xx", async () => {
    const { double, transport } = build({ "GET /rest/V1/x": json(403, { message: "no" }) });
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "forbidden" });
    expect(double.calls).toHaveLength(1);
  });

  it("classifies an unparseable 200 body", async () => {
    const { transport } = build({ "GET /rest/V1/x": { status: 200, body: "<html>not json</html>" } });
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "unparseable" });
  });

  it("never calls fetch when no credential is available", async () => {
    const empty = new StaticTokenProvider({
      domain: "magento-rest",
      resolve: () => {
        throw new Error("none");
      },
      remedy,
    });
    const double = createFetchDouble({});
    const transport = createRestTransport({ fetch: double.fetch, now: () => 0, sleep: async () => {}, baseUrl: SYNTHETIC_MAGENTO_BASE_URL, tokenProvider: empty });
    await expect(transport.request({ method: "GET", path: "/x" })).rejects.toThrow(/Missing credential/);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses a path that carries its own query or fragment", async () => {
    const { double, transport } = build({});
    await expect(transport.request({ method: "GET", path: "/products?x=1" })).rejects.toThrow(/path/i);
    await expect(transport.request({ method: "GET", path: "/products#x" })).rejects.toThrow(/path/i);
    await expect(transport.request({ method: "GET", path: "products" })).rejects.toThrow(/path/i);
    expect(double.calls).toHaveLength(0);
  });
});

describe("createRestTransport base URL", () => {
  const make = (baseUrl: string) => () =>
    createRestTransport({ fetch: createFetchDouble({}).fetch, now: () => 0, sleep: async () => {}, baseUrl, tokenProvider });

  it("refuses plaintext http for a non-loopback host", () => {
    expect(make("http://demo-host.example-domain/rest/V1")).toThrow(/https/);
  });

  it.each(["http://localhost/rest/V1", "http://127.0.0.1:8080/rest/V1", "http://[::1]/rest/V1"])("allows plaintext http for loopback %s", (url) => {
    expect(make(url)).not.toThrow();
  });

  it("refuses a value that is not a URL, and a non-http scheme", () => {
    expect(make("demo-host.example-domain")).toThrow(/URL/);
    expect(make("ftp://demo-host.example-domain/rest/V1")).toThrow(/https/);
  });

  it("refuses credentials embedded in the URL", () => {
    expect(make("https://user:pw@demo-host.example-domain/rest/V1")).toThrow(/credentials/i);
  });
});
