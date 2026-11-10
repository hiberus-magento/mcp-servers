// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The original `fetchAllPages` looped until Magento ran out of
// pages, so an analytics tool over a big order history pulled the whole table
// into memory. `getAllPages` has a hard page cap and says when it hit it.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createFetchDouble, json, type RouteTable } from "../testing/fetch-double.js";
import { createMagentoRestClient } from "./index.js";

const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };
const tokenProvider = new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy });

const build = (routes: RouteTable) => {
  const double = createFetchDouble(routes);
  // The clock advances only when the limiter sleeps, so pacing is exercised
  // without waiting; a frozen clock would let the limiter spin forever.
  let clock = 0;
  const client = createMagentoRestClient({
    fetch: double.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
    tokenProvider,
  });
  return { double, client };
};

const page = (items: unknown[], total: number) => json(200, { items, total_count: total });

describe("createMagentoRestClient", () => {
  it("get returns the parsed body and encodes the query it is given", async () => {
    const { double, client } = build({ "GET /rest/V1/store/websites": json(200, [{ id: 1 }]) });
    expect(await client.get("/store/websites")).toEqual([{ id: 1 }]);
    expect(double.calls[0]?.method).toBe("GET");
  });

  it("search sends a bounded searchCriteria and returns items with the total", async () => {
    const { double, client } = build({ "GET /rest/V1/orders": page([{ entity_id: 1 }], 41) });
    const result = await client.search("/orders", { filterGroups: [[{ field: "status", value: "pending" }]], pageSize: 10 });
    expect(result).toEqual({ items: [{ entity_id: 1 }], totalCount: 41 });
    const url = new URL(double.calls[0]?.url ?? "");
    expect(url.searchParams.get("searchCriteria[pageSize]")).toBe("10");
    expect(url.searchParams.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("pending");
  });

  it("search tolerates a response with no items array", async () => {
    const { client } = build({ "GET /rest/V1/orders": json(200, {}) });
    expect(await client.search("/orders", {})).toEqual({ items: [], totalCount: 0 });
  });

  it("post, put and delete send the method and body", async () => {
    const { double, client } = build({
      "POST /rest/V1/a": json(200, 1),
      "PUT /rest/V1/a": json(200, 2),
      "DELETE /rest/V1/a": json(200, true),
    });
    await client.post("/a", { x: 1 });
    await client.put("/a", { x: 2 });
    expect(await client.delete("/a")).toBe(true);
    expect(double.calls.map((c) => c.method)).toEqual(["POST", "PUT", "DELETE"]);
    expect(double.calls[0]?.body).toBe('{"x":1}');
  });

  describe("getAllPages", () => {
    it("walks pages of 100 until it has every item", async () => {
      const first = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const second = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i }));
      const { double, client } = build({
        "GET /rest/V1/orders": (call) => {
          const current = new URL(call.url).searchParams.get("searchCriteria[currentPage]");
          return current === "1" ? page(first, 130) : page(second, 130);
        },
      });
      const result = await client.getAllPages("/orders", {}, { maxPages: 5 });
      expect(result.items).toHaveLength(130);
      expect(result.truncated).toBe(false);
      expect(result.totalCount).toBe(130);
      expect(double.calls).toHaveLength(2);
      expect(new URL(double.calls[0]?.url ?? "").searchParams.get("searchCriteria[pageSize]")).toBe("100");
    });

    it("stops at maxPages and reports truncation instead of fetching everything", async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const { double, client } = build({ "GET /rest/V1/orders": page(full, 100_000) });
      const result = await client.getAllPages("/orders", {}, { maxPages: 3 });
      expect(double.calls).toHaveLength(3);
      expect(result.items).toHaveLength(300);
      expect(result.truncated).toBe(true);
      expect(result.totalCount).toBe(100_000);
    });

    it("stops on a short page even if total_count says there is more", async () => {
      const { double, client } = build({ "GET /rest/V1/orders": page([{ id: 1 }], 500) });
      const result = await client.getAllPages("/orders", {}, { maxPages: 5 });
      expect(double.calls).toHaveLength(1);
      expect(result.truncated).toBe(false);
    });

    it("has a default cap, so no call is unbounded even when the caller forgets one", async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const { double, client } = build({ "GET /rest/V1/orders": page(full, 1_000_000) });
      const result = await client.getAllPages("/orders", {});
      expect(double.calls.length).toBeLessThanOrEqual(10);
      expect(result.truncated).toBe(true);
    });

    it("refuses a maxPages above the hard ceiling", async () => {
      const { client } = build({});
      await expect(client.getAllPages("/orders", {}, { maxPages: 1000 })).rejects.toThrow(/maxPages/);
    });
  });
});
