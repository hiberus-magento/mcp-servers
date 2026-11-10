// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The transport is the only code that talks to the network. It must guarantee: the
// customer token travels only in the Authorization header and only when there is one; variables
// are never interpolated into the document; a failure carries neither the body nor the token;
// a query is retried and a mutation never is; and a plaintext base URL is refused.
import { SYNTHETIC_MAGENTO_CUSTOMER_TOKEN, SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createFetchDouble, data, gqlErrors, json, type Responder } from "../testing/fetch-double.js";
import { MagentoGraphqlError } from "./errors.js";
import { createGraphqlTransport } from "./http.js";

const build = (responder: Responder, options: { token?: string | undefined; baseUrl?: string; store?: string } = {}) => {
  const double = createFetchDouble(responder);
  const sleeps: number[] = [];
  let clock = 0;
  const transport = createGraphqlTransport({
    fetch: double.fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    baseUrl: options.baseUrl ?? SYNTHETIC_MAGENTO_GRAPHQL_URL,
    getToken: async () => options.token,
    ...(options.store !== undefined ? { defaultStore: options.store } : {}),
  });
  return { double, sleeps, transport };
};

const Q = "query { storeConfig { store_code } }";

describe("createGraphqlTransport", () => {
  it("POSTs the document and variables as JSON and returns `data`", async () => {
    const { double, transport } = build(data({ storeConfig: { store_code: "x" } }));
    const result = await transport.execute({ kind: "query", document: Q, variables: { a: 1 } });
    expect(result).toEqual({ data: { storeConfig: { store_code: "x" } } });
    expect(double.calls[0]?.method).toBe("POST");
    expect(double.calls[0]?.url).toBe(SYNTHETIC_MAGENTO_GRAPHQL_URL);
    expect(double.calls[0]?.request).toEqual({ query: Q, variables: { a: 1 } });
    expect(double.calls[0]?.headers["content-type"]).toBe("application/json");
  });

  it("sends no Authorization header when there is no token (anonymous)", async () => {
    const { double, transport } = build(data({}));
    await transport.execute({ kind: "query", document: Q });
    expect(double.calls[0]?.headers["authorization"]).toBeUndefined();
  });

  it("sends the customer token as a Bearer, and nowhere else", async () => {
    const { double, transport } = build(data({}), { token: SYNTHETIC_MAGENTO_CUSTOMER_TOKEN });
    await transport.execute({ kind: "query", document: Q });
    expect(double.calls[0]?.headers["authorization"]).toBe(`Bearer ${SYNTHETIC_MAGENTO_CUSTOMER_TOKEN}`);
    expect(double.calls[0]?.url).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
    expect(double.calls[0]?.body).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
  });

  it("sends the Store header from the default, and a per-call store wins", async () => {
    const { double, transport } = build(data({}), { store: "default" });
    await transport.execute({ kind: "query", document: Q });
    await transport.execute({ kind: "query", document: Q, store: "de_de" });
    expect(double.calls[0]?.headers["store"]).toBe("default");
    expect(double.calls[1]?.headers["store"]).toBe("de_de");
  });

  it("sends no Store header when none is configured, and Content-Currency when asked", async () => {
    const { double, transport } = build(data({}));
    await transport.execute({ kind: "query", document: Q, currency: "EUR" });
    expect(double.calls[0]?.headers["store"]).toBeUndefined();
    expect(double.calls[0]?.headers["content-currency"]).toBe("EUR");
  });

  it.each(["De De", "x".repeat(33), "a;b", ""])("refuses the store code %j", async (store) => {
    const { double, transport } = build(data({}));
    await expect(transport.execute({ kind: "query", document: Q, store })).rejects.toThrow(/store/i);
    expect(double.calls).toHaveLength(0);
  });

  it.each(["eur", "EURO", "E1R"])("refuses the currency %j", async (currency) => {
    const { transport } = build(data({}));
    await expect(transport.execute({ kind: "query", document: Q, currency })).rejects.toThrow(/currency/i);
  });

  it("throws the GraphQL errors when there is no data", async () => {
    const { transport } = build(gqlErrors(['Cannot query field "nope" on type "Query".']));
    const error = await transport.execute({ kind: "query", document: Q }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MagentoGraphqlError);
    expect((error as MagentoGraphqlError).message).toContain("Cannot query field");
  });

  it("returns partial data together with the messages", async () => {
    const { transport } = build(gqlErrors(["The current customer isn't authorized."], { storeConfig: { store_code: "x" }, customer: null }));
    const result = await transport.execute({ kind: "query", document: Q });
    expect(result.data).toEqual({ storeConfig: { store_code: "x" }, customer: null });
    expect(result.errors).toEqual(["The current customer isn't authorized."]);
  });

  it("throws a classified error for an HTTP failure that carries neither the body nor the token", async () => {
    const { transport } = build(json(502, "<html>secret-internal-host</html>"), { token: SYNTHETIC_MAGENTO_CUSTOMER_TOKEN, ...{} });
    const error = (await transport.execute({ kind: "mutation", document: "mutation { a }" }).catch((e: unknown) => e)) as MagentoGraphqlError;
    expect(error.kind).toBe("server");
    expect(error.message).not.toContain("secret-internal-host");
    expect(error.message).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
  });

  it("throws `unparseable` for a success status with a body that is not JSON", async () => {
    const { transport } = build({ status: 200, body: "not json" });
    expect(((await transport.execute({ kind: "query", document: Q }).catch((e: unknown) => e)) as MagentoGraphqlError).kind).toBe("unparseable");
  });

  it("throws `unparseable` for JSON that is neither data nor errors", async () => {
    const { transport } = build(json(200, { hello: "world" }));
    expect(((await transport.execute({ kind: "query", document: Q }).catch((e: unknown) => e)) as MagentoGraphqlError).kind).toBe("unparseable");
  });

  it("refuses to follow a redirect, surfacing it as a failure", async () => {
    const { double, transport } = build({ status: 302, headers: { location: "https://elsewhere.example/graphql" } });
    await expect(transport.execute({ kind: "query", document: Q })).rejects.toBeInstanceOf(MagentoGraphqlError);
    expect(double.calls).toHaveLength(1);
  });

  describe("retries", () => {
    it("retries a query on 503 and returns the later success", async () => {
      const { double, transport, sleeps } = build([json(503, ""), data({ ok: 1 })]);
      expect((await transport.execute({ kind: "query", document: Q })).data).toEqual({ ok: 1 });
      expect(double.calls).toHaveLength(2);
      expect(sleeps.length).toBeGreaterThan(0);
    });

    it("gives up on a query after three attempts", async () => {
      const { double, transport } = build(json(503, ""));
      await expect(transport.execute({ kind: "query", document: Q })).rejects.toBeInstanceOf(MagentoGraphqlError);
      expect(double.calls).toHaveLength(3);
    });

    it("NEVER retries a mutation, even on 503", async () => {
      const { double, transport } = build(json(503, ""));
      await expect(transport.execute({ kind: "mutation", document: "mutation { a }" })).rejects.toBeInstanceOf(MagentoGraphqlError);
      expect(double.calls).toHaveLength(1);
    });

    it("does not retry a GraphQL-level error", async () => {
      const { double, transport } = build(gqlErrors(["bad"]));
      await expect(transport.execute({ kind: "query", document: Q })).rejects.toBeInstanceOf(MagentoGraphqlError);
      expect(double.calls).toHaveLength(1);
    });

    it("retries a transport failure of a query but not of a mutation", async () => {
      let calls = 0;
      const failing = (async () => {
        calls += 1;
        throw new Error("ECONNRESET to secret-internal-host");
      }) as unknown as typeof globalThis.fetch;
      const make = () =>
        createGraphqlTransport({ fetch: failing, now: () => 0, sleep: async () => undefined, random: () => 0, baseUrl: SYNTHETIC_MAGENTO_GRAPHQL_URL, getToken: async () => undefined });
      const error = (await make().execute({ kind: "query", document: Q }).catch((e: unknown) => e)) as MagentoGraphqlError;
      expect(error.kind).toBe("transport");
      expect(error.message).not.toContain("secret-internal-host");
      expect(calls).toBe(3);
      calls = 0;
      await make().execute({ kind: "mutation", document: "mutation { a }" }).catch(() => undefined);
      expect(calls).toBe(1);
    });
  });

  describe("base URL", () => {
    it.each(["http://demo-host.example-domain/graphql", "ftp://x/graphql", "not a url", "https://user:pw@demo-host.example-domain/graphql"])("refuses %s", (baseUrl) => {
      expect(() => build(data({}), { baseUrl })).toThrow();
    });
    it.each(["http://localhost/graphql", "http://127.0.0.1:8080/graphql"])("allows plaintext only for loopback: %s", (baseUrl) => {
      expect(() => build(data({}), { baseUrl })).not.toThrow();
    });
  });
});
