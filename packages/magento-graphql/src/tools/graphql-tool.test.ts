// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The factory is where the guarantees every tool shares are written once: strict
// inputs, annotations from the kind of effect, the operation kind of the document checked when
// the tool is BUILT (a read tool holding a mutation fails at startup, not on a call), partial
// errors shown rather than dropped, and the unverified marker.
import { SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMagentoGraphqlClient } from "../client/index.js";
import { createFetchDouble, data, gqlErrors } from "../testing/fetch-double.js";
import { createToolFactory } from "./graphql-tool.js";
import { UNVERIFIED_MARKER } from "./verification.js";

const setup = (responder: Parameters<typeof createFetchDouble>[0], options: Parameters<typeof createToolFactory>[1] = {}) => {
  const double = createFetchDouble(responder);
  const client = createMagentoGraphqlClient({ fetch: double.fetch, now: () => 0, sleep: async () => undefined, baseUrl: SYNTHETIC_MAGENTO_GRAPHQL_URL, getToken: async () => undefined });
  return { double, factory: createToolFactory(() => client, options) };
};

const input = z.object({ term: z.string() }).strict();

describe("createToolFactory", () => {
  it("runs the fixed document with the variables the tool builds, and unwraps `pick`", async () => {
    const { double, factory } = setup(data({ products: { total_count: 1 } }));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "query X($s: String) { products(search: $s) { total_count } }", variables: (a) => ({ s: a.term }), pick: "products" });
    const result = await tool.invoke({ term: "tent" }, {});
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ total_count: 1 });
    expect(double.calls[0]?.request?.variables).toEqual({ s: "tent" });
    expect(double.calls[0]?.request?.query).not.toContain("tent");
  });

  it("returns the whole `data` without `pick`", async () => {
    const { factory } = setup(data({ a: 1 }));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }" });
    expect(JSON.parse((await tool.invoke({ term: "" }, {})).content[0]?.text ?? "")).toEqual({ a: 1 });
  });

  it("shows partial-data errors next to the data instead of dropping them", async () => {
    const { factory } = setup(gqlErrors(["The current customer isn't authorized."], { customer: null }));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ customer { email } }", pick: "customer" });
    expect(JSON.parse((await tool.invoke({ term: "" }, {})).content[0]?.text ?? "")).toEqual({ data: null, errors: ["The current customer isn't authorized."] });
  });

  it("applies `transform` to the picked value", async () => {
    const { factory } = setup(data({ products: { items: [] } }));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ products { items } }", pick: "products", transform: (v, a) => ((v as { items: unknown[] }).items.length === 0 ? `none for ${a.term}` : v) });
    expect((await tool.invoke({ term: "tent" }, {})).content[0]?.text).toBe("none for tent");
  });

  it("rejects an argument the schema does not declare", async () => {
    const { factory } = setup(data({}));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }" });
    await expect(tool.invoke({ term: "a", extra: 1 }, {})).rejects.toThrow();
  });

  it("passes the store and currency the tool chooses", async () => {
    const { double, factory } = setup(data({}));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }", context: () => ({ store: "de_de", currency: "EUR" }) });
    await tool.invoke({ term: "" }, {});
    expect(double.calls[0]?.headers["store"]).toBe("de_de");
    expect(double.calls[0]?.headers["content-currency"]).toBe("EUR");
  });

  it("marks reads read-only and idempotent", () => {
    const { factory } = setup(data({}));
    const tool = factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }" });
    expect(tool.access).toBe("read");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });

  it.each([
    ["create", false, false],
    ["update", true, true],
    ["delete", true, true],
    ["action", true, false],
  ] as const)("a %s write has destructive=%s idempotent=%s and uses mutate()", async (effect, destructive, idempotent) => {
    const { double, factory } = setup(data({ createEmptyCart: "abc" }));
    const tool = factory.writeTool({ name: "magentographql_w", description: "Use this to w.", input, document: "mutation { createEmptyCart }", effect, pick: "createEmptyCart" });
    expect(tool.access).toBe("write");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent });
    expect((await tool.invoke({ term: "" }, {})).content[0]?.text).toBe("abc");
    expect(double.calls).toHaveLength(1);
  });

  it("refuses to BUILD a read tool whose document is a mutation, and a write tool whose document is a query", () => {
    const { factory } = setup(data({}));
    expect(() => factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "mutation { a }" })).toThrow(/mutation/);
    expect(() => factory.writeTool({ name: "magentographql_w", description: "Use this to w.", input, document: "{ a }", effect: "update" })).toThrow(/query/);
  });

  it("refuses to BUILD a tool whose document has two operations or is unreadable", () => {
    const { factory } = setup(data({}));
    expect(() => factory.readTool({ name: "magentographql_x", description: "d", input, document: "query A { a } query B { b }" })).toThrow();
    expect(() => factory.readTool({ name: "magentographql_x", description: "d", input, document: "{ a " })).toThrow();
  });

  it("appends the unverified marker to a tool that is not on the live-verified list, and not to one that is", () => {
    const unverified = setup(data({})).factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }" });
    expect(unverified.description).toContain(UNVERIFIED_MARKER);
    const verified = setup(data({}), { liveVerified: new Set(["magentographql_x"]) }).factory.readTool({ name: "magentographql_x", description: "Use this to x.", input, document: "{ a }" });
    expect(verified.description).toBe("Use this to x.");
  });
});
