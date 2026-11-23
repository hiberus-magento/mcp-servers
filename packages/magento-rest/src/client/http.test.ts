// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The transport is the only code that talks to the network. What
// it must guarantee: the token travels only in the Authorization header, a
// failure never carries the response body, a read is retried but a write is
// never replayed, and a plaintext base URL is refused (a Bearer over http is
// a Bearer on the wire).
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
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

  describe("an attempt that never gets a response", () => {
    // A fetch that only settles when its signal aborts: Magento accepted the connection and never answered.
    const hangingFetch = () => {
      const calls: string[] = [];
      const fetch = ((input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input));
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) return;
          signal.addEventListener("abort", () => reject(signal.reason as Error));
        });
      }) as typeof globalThis.fetch;
      return { calls, fetch };
    };
    const buildHanging = () => {
      const hanging = hangingFetch();
      const transport = createRestTransport({ fetch: hanging.fetch, now: () => 0, sleep: async () => {}, random: () => 0.5, baseUrl: SYNTHETIC_MAGENTO_BASE_URL, tokenProvider, timeoutMs: 20 });
      return { calls: hanging.calls, transport };
    };

    it("is aborted after the timeout and reported as a transport error that says it timed out", async () => {
      const { transport } = buildHanging();
      await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "transport", timedOut: true, message: expect.stringMatching(/timed out after/) as unknown });
    });

    it("retries a read that timed out", async () => {
      const { calls, transport } = buildHanging();
      await transport.request({ method: "GET", path: "/x" }).catch(() => undefined);
      expect(calls.length).toBeGreaterThan(1);
    });

    it("is aborted when the status arrives but the body stalls", async () => {
      const fetch = ((_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener("abort", () => controller.error(signal.reason));
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }) as typeof globalThis.fetch;
      const transport = createRestTransport({ fetch, now: () => 0, sleep: async () => {}, random: () => 0.5, baseUrl: SYNTHETIC_MAGENTO_BASE_URL, tokenProvider, timeoutMs: 20 });
      await expect(transport.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "transport", message: expect.stringMatching(/timed out after/) as unknown });
    });

    it("never replays a write that timed out", async () => {
      const { calls, transport } = buildHanging();
      await expect(transport.request({ method: "POST", path: "/x", body: {} })).rejects.toMatchObject({ kind: "transport" });
      expect(calls).toHaveLength(1);
    });
  });

  describe("a request the MCP client cancels", () => {
    const buildCancellable = () => {
      const calls: string[] = [];
      const fetch = ((input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        });
      }) as typeof globalThis.fetch;
      const transport = createRestTransport({ fetch, now: () => 0, sleep: async () => {}, random: () => 0.5, baseUrl: SYNTHETIC_MAGENTO_BASE_URL, tokenProvider, timeoutMs: 60_000 });
      return { calls, transport };
    };

    it("aborts the in-flight fetch, is not retried, and says it was cancelled", async () => {
      const { calls, transport } = buildCancellable();
      const controller = new AbortController();
      const pending = transport.request({ method: "GET", path: "/x", signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 5));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ kind: "transport", retryable: false, message: expect.stringMatching(/cancelled/) as unknown });
      expect(calls).toHaveLength(1);
    });

    it("never calls fetch when the signal is already aborted", async () => {
      const { calls, transport } = buildCancellable();
      await expect(transport.request({ method: "GET", path: "/x", signal: AbortSignal.abort() })).rejects.toMatchObject({ message: expect.stringMatching(/cancelled/) as unknown });
      expect(calls).toHaveLength(0);
    });
  });

  describe("store scope", () => {
    it("sends a request with a scope to /rest/<scope>/V1, and one without it to the base URL", async () => {
      const { double, transport } = build({ "PUT /rest/all/V1/products/x": json(200, {}), "GET /rest/V1/products/x": json(200, {}) });
      await transport.request({ method: "PUT", path: "/products/x", body: {}, scope: "all" });
      await transport.request({ method: "GET", path: "/products/x" });
      expect(double.calls.map((call) => new URL(call.url).pathname)).toEqual(["/rest/all/V1/products/x", "/rest/V1/products/x"]);
    });

    it("replaces the store code a base URL already carries", async () => {
      const { double, transport } = build({ "PUT /rest/demo_view/V1/products/x": json(200, {}) }, SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/rest/default/V1"));
      await transport.request({ method: "PUT", path: "/products/x", body: {}, scope: "demo_view" });
      expect(new URL(double.calls[0]?.url ?? "").pathname).toBe("/rest/demo_view/V1/products/x");
    });

    it("refuses a scope that is not a store code, and a scope when the base URL does not end in /rest/V1", async () => {
      const { double, transport } = build({});
      await expect(transport.request({ method: "PUT", path: "/x", body: {}, scope: "all/../V1" })).rejects.toThrow(/store code/);
      const other = build({}, "https://demo-host.example-domain/api");
      await expect(other.transport.request({ method: "PUT", path: "/x", body: {}, scope: "all" })).rejects.toThrow(/rest\/V1/);
      expect(double.calls).toHaveLength(0);
      expect(other.double.calls).toHaveLength(0);
    });
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

describe("createRestTransport — what answered (provenance)", () => {
  it("reports the method and the path from /rest on, without host or query, with the time Magento answered", async () => {
    const { transport } = build({ "GET /rest/V1/orders": json(200, { items: [] }) });
    const answers: unknown[] = [];
    await transport.request({ method: "GET", path: "/orders", query: `searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(SYNTHETIC_MAGENTO_CUSTOMER_EMAIL)}`, onAnswered: (answer) => answers.push(answer) });
    expect(answers).toEqual([{ endpoint: "GET /rest/V1/orders", readAt: "1970-01-01T00:00:00.000Z" }]);
  });

  it("names the store view of a scoped request, and of a base URL with a store code", async () => {
    const scoped = build({ "GET /rest/demo_view/V1/products/x": json(200, {}) });
    const answers: unknown[] = [];
    await scoped.transport.request({ method: "GET", path: "/products/x", scope: "demo_view", onAnswered: (answer) => answers.push(answer) });
    const viewBase = build({ "GET /rest/demo_view/V1/products/x": json(200, {}) }, SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/rest/demo_view/V1"));
    await viewBase.transport.request({ method: "GET", path: "/products/x", onAnswered: (answer) => answers.push(answer) });
    expect(answers).toEqual([
      { endpoint: "GET /rest/demo_view/V1/products/x", readAt: "1970-01-01T00:00:00.000Z", storeView: "demo_view" },
      { endpoint: "GET /rest/demo_view/V1/products/x", readAt: "1970-01-01T00:00:00.000Z", storeView: "demo_view" },
    ]);
  });

  it("names no store view for the global scope, which is not a store view", async () => {
    const { transport } = build({ "GET /rest/all/V1/products/x": json(200, {}) });
    const answers: unknown[] = [];
    await transport.request({ method: "GET", path: "/products/x", scope: "all", onAnswered: (answer) => answers.push(answer) });
    expect(answers).toEqual([{ endpoint: "GET /rest/all/V1/products/x", readAt: "1970-01-01T00:00:00.000Z" }]);
  });

  it("names no store view when the base URL itself is the global /rest/all/V1", async () => {
    const { transport } = build({ "GET /rest/all/V1/orders/5": json(200, {}) }, SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/rest/all/V1"));
    const answers: unknown[] = [];
    await transport.request({ method: "GET", path: "/orders/5", onAnswered: (answer) => answers.push(answer) });
    expect(answers).toEqual([{ endpoint: "GET /rest/all/V1/orders/5", readAt: "1970-01-01T00:00:00.000Z" }]);
  });

  it("reports nothing for a request that failed", async () => {
    const { transport } = build({ "GET /rest/V1/orders/9": json(404, { message: "No such entity." }) });
    const answers: unknown[] = [];
    await expect(transport.request({ method: "GET", path: "/orders/9", onAnswered: (answer) => answers.push(answer) })).rejects.toBeInstanceOf(MagentoRestError);
    expect(answers).toEqual([]);
  });
});

describe("createRestTransport — a redirect", () => {
  // A store with "Add Store Code to Urls" answers /rest/... with a 301 to /<code>/rest/.... The redirect is not
  // followed (it would re-send the token somewhere the operator never configured), but the failure names the base
  // URL to use instead.
  it("is not followed, and says which base URL the store redirects to", async () => {
    const target = `${SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/es/rest/V1")}/store/storeViews`;
    const { double, transport } = build({ "GET /rest/V1/store/storeViews": { status: 301, headers: { location: target } } });
    const failure = await transport.request({ method: "GET", path: "/store/storeViews" }).catch((error: unknown) => error);
    expect(double.calls).toHaveLength(1);
    expect(failure).toMatchObject({ kind: "redirected", status: 301, suggestedBaseUrl: SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/es/rest/V1") });
    expect((failure as Error).message).toContain(SYNTHETIC_MAGENTO_BASE_URL.replace("/rest/V1", "/es/rest/V1"));
  });

  it("names no base URL when the target does not end in the same request path", async () => {
    const { transport } = build({ "GET /rest/V1/store/storeViews": { status: 302, headers: { location: "https://login.example-domain/sso?next=x" } } });
    const failure = await transport.request({ method: "GET", path: "/store/storeViews" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "redirected", status: 302 });
    expect((failure as { suggestedBaseUrl?: string }).suggestedBaseUrl).toBeUndefined();
    expect((failure as Error).message).not.toContain("next=x");
  });
});
