// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { data } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { productTools } from "./products-tools.js";

const PRODUCTS = { products: { total_count: 1, page_info: { current_page: 1, page_size: 10, total_pages: 1 }, items: [{ sku: "DEMO-TENT-001", name: "Tent" }] } };

describe("productTools", () => {
  it("exposes exactly the two read tools", () => {
    const { tools } = buildToolHarness(productTools, data({}));
    expect(tools.map((t) => t.name).sort()).toEqual(["magentographql_get_product", "magentographql_search_products"]);
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });

  describe("search_products", () => {
    it("sends a search term as a variable, with defaults, and returns the products block", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      expect(await h.call("magentographql_search_products", { search: "tent" })).toEqual(PRODUCTS.products);
      expect(h.lastVariables()).toMatchObject({ search: "tent", pageSize: 10, currentPage: 1, aggregations: false });
    });

    it("builds the filter and sort from the arguments", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await h.call("magentographql_search_products", { sku: ["A-1", "B-2"], category_uid: "MTI=", price_from: 10, price_to: 99.5, sort_by: "price", sort_direction: "ASC", page_size: 25, current_page: 2, include_aggregations: true });
      expect(h.lastVariables()).toEqual({
        filter: { sku: { in: ["A-1", "B-2"] }, category_uid: { eq: "MTI=" }, price: { from: "10", to: "99.5" } },
        sort: { price: "ASC" },
        pageSize: 25,
        currentPage: 2,
        aggregations: true,
      });
    });

    it("uses an exact match for a single sku", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await h.call("magentographql_search_products", { sku: ["ONLY-1"] });
      expect(h.lastVariables()?.["filter"]).toEqual({ sku: { eq: "ONLY-1" } });
    });

    it("never puts an argument in the document", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await h.call("magentographql_search_products", { search: 'x") { evil } #' });
      expect(h.double.calls[0]?.request?.query).not.toContain("evil");
    });

    it("needs a search term or a filter, which Magento also demands", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await expect(h.call("magentographql_search_products", {})).rejects.toThrow(/search|sku|category/);
      expect(h.double.calls).toHaveLength(0);
    });

    it.each([{ page_size: 0 }, { page_size: 51 }, { current_page: 0 }, { sku: [] }, { sku: Array.from({ length: 51 }, (_, i) => `S${i}`) }, { sort_by: "color" }])("refuses %j", async (bad) => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await expect(h.call("magentographql_search_products", { search: "a", ...bad })).rejects.toThrow();
    });

    it("sends the store and currency as headers, not variables", async () => {
      const h = buildToolHarness(productTools, data(PRODUCTS));
      await h.call("magentographql_search_products", { search: "a", store: "de_de", currency: "EUR" });
      expect(h.double.calls[0]?.headers["store"]).toBe("de_de");
      expect(h.double.calls[0]?.headers["content-currency"]).toBe("EUR");
      expect(h.lastVariables()).not.toHaveProperty("store");
    });
  });

  describe("get_product", () => {
    const ONE = { products: { items: [{ sku: "DEMO-TENT-001", name: "Tent" }] } };

    it("looks a product up by sku and returns the item", async () => {
      const h = buildToolHarness(productTools, data(ONE));
      expect(await h.call("magentographql_get_product", { sku: "DEMO-TENT-001" })).toEqual(ONE.products.items[0]);
      expect(h.lastVariables()).toEqual({ filter: { sku: { eq: "DEMO-TENT-001" } } });
    });

    it("looks a product up by url_key", async () => {
      const h = buildToolHarness(productTools, data(ONE));
      await h.call("magentographql_get_product", { url_key: "tent" });
      expect(h.lastVariables()).toEqual({ filter: { url_key: { eq: "tent" } } });
    });

    it("says so when nothing matches, instead of returning an empty list", async () => {
      const h = buildToolHarness(productTools, data({ products: { items: [] } }));
      expect(await h.call("magentographql_get_product", { sku: "NOPE" })).toBe("No product matches this sku or url_key in the storefront (it may be disabled, not visible, or in another store view).");
    });

    it.each([{}, { sku: "A", url_key: "a" }])("needs exactly one of sku and url_key: %j", async (args) => {
      const h = buildToolHarness(productTools, data(ONE));
      await expect(h.call("magentographql_get_product", args)).rejects.toThrow(/exactly one/);
    });
  });
});
