// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `query()` and `mutate()` each refuse the other's operation BEFORE any request is
// sent (design D1): that is what keeps the generic query tool read-only.
import { SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createFetchDouble, data } from "../testing/fetch-double.js";
import { OperationGuardError } from "./operation-guard.js";
import { createMagentoGraphqlClient } from "./index.js";

const build = () => {
  const double = createFetchDouble(data({ ok: true }));
  const client = createMagentoGraphqlClient({ fetch: double.fetch, now: () => 0, sleep: async () => undefined, baseUrl: SYNTHETIC_MAGENTO_GRAPHQL_URL, getToken: async () => undefined });
  return { double, client };
};

describe("createMagentoGraphqlClient", () => {
  it("runs a query", async () => {
    const { client, double } = build();
    expect((await client.query("{ a }")).data).toEqual({ ok: true });
    expect(double.calls).toHaveLength(1);
  });

  it("runs a mutation", async () => {
    const { client } = build();
    expect((await client.mutate("mutation { createEmptyCart }")).data).toEqual({ ok: true });
  });

  it.each([
    ["a mutation", "mutation { createEmptyCart }"],
    ["a subscription", "subscription { x }"],
    ["a query and a mutation together", "query A { a } mutation B { b }"],
    ["two queries", "query A { a } query B { b }"],
    ["an unreadable document", "query { a "],
  ])("query() refuses %s without sending anything", async (_label, document) => {
    const { client, double } = build();
    await expect(client.query(document)).rejects.toBeInstanceOf(OperationGuardError);
    expect(double.calls).toHaveLength(0);
  });

  it.each([
    ["a query", "query { a }"],
    ["a shorthand query", "{ a }"],
    ["two mutations", "mutation A { a } mutation B { b }"],
    ["a subscription", "subscription { x }"],
  ])("mutate() refuses %s without sending anything", async (_label, document) => {
    const { client, double } = build();
    await expect(client.mutate(document)).rejects.toBeInstanceOf(OperationGuardError);
    expect(double.calls).toHaveLength(0);
  });

  it("passes variables, store and currency through", async () => {
    const { client, double } = build();
    await client.query("query($s: String) { a(s: $s) }", { variables: { s: "tent" }, store: "de_de", currency: "EUR" });
    expect(double.calls[0]?.request?.variables).toEqual({ s: "tent" });
    expect(double.calls[0]?.headers["store"]).toBe("de_de");
    expect(double.calls[0]?.headers["content-currency"]).toBe("EUR");
  });
});
