// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { data } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { categoryTools } from "./categories-tools.js";
import { cmsTools } from "./cms-tools.js";
import { storeTools } from "./store-tools.js";

describe("categoryTools", () => {
  it("exposes two read tools", () => {
    expect(buildToolHarness(categoryTools, data({})).tools.map((t) => t.name).sort()).toEqual(["magentographql_get_category", "magentographql_get_category_tree"]);
  });

  it("reads the tree from the store root, or below a uid", async () => {
    const h = buildToolHarness(categoryTools, data({ categories: { items: [{ uid: "Mg==", name: "Root", children: [] }] } }));
    expect(await h.call("magentographql_get_category_tree", {})).toEqual([{ uid: "Mg==", name: "Root", children: [] }]);
    expect(h.lastVariables()).toEqual({});
    await h.call("magentographql_get_category_tree", { category_uid: "MTI=" });
    expect(h.lastVariables()).toEqual({ filters: { category_uid: { eq: "MTI=" } } });
  });

  it("reads one category by uid or by url_path, and says so when none matches", async () => {
    const h = buildToolHarness(categoryTools, data({ categories: { items: [{ uid: "MTI=", name: "Tents", url_path: "gear/tents" }] } }));
    expect(await h.call("magentographql_get_category", { url_path: "gear/tents" })).toEqual({ uid: "MTI=", name: "Tents", url_path: "gear/tents" });
    expect(h.lastVariables()).toEqual({ filters: { url_path: { eq: "gear/tents" } } });
    await h.call("magentographql_get_category", { category_uid: "MTI=" });
    expect(h.lastVariables()).toEqual({ filters: { category_uid: { eq: "MTI=" } } });
    const none = buildToolHarness(categoryTools, data({ categories: { items: [] } }));
    expect(await none.call("magentographql_get_category", { url_path: "x" })).toMatch(/No category matches/);
  });

  // Seen against a live store: `categories` ignores a filter it cannot decode and answers with ANOTHER category, so an
  // answer is trusted only when it is the one that was asked for.
  it("does not return a different category when the filter was ignored", async () => {
    const other = { uid: "NA==", name: "Other", url_path: "other" };
    const h = buildToolHarness(categoryTools, data({ categories: { items: [other] } }));
    expect(await h.call("magentographql_get_category", { category_uid: "NOPE" })).toMatch(/No category matches/);
    expect(await h.call("magentographql_get_category", { url_path: "gear/tents" })).toMatch(/No category matches/);
    expect(await h.call("magentographql_get_category", { url_path: "other" })).toEqual(other);
    expect(await h.call("magentographql_get_category_tree", { category_uid: "NOPE" })).toMatch(/No category matches/);
    expect(await h.call("magentographql_get_category_tree", { category_uid: "NA==" })).toEqual([other]);
  });

  it("needs exactly one of category_uid and url_path", async () => {
    const h = buildToolHarness(categoryTools, data({ categories: { items: [] } }));
    await expect(h.call("magentographql_get_category", {})).rejects.toThrow(/exactly one/);
    await expect(h.call("magentographql_get_category", { category_uid: "MTI=", url_path: "a" })).rejects.toThrow(/exactly one/);
  });
});

describe("cmsTools", () => {
  it("reads a page by identifier", async () => {
    const h = buildToolHarness(cmsTools, data({ cmsPage: { identifier: "home", title: "Home" } }));
    expect(await h.call("magentographql_get_cms_page", { identifier: "home" })).toEqual({ identifier: "home", title: "Home" });
    expect(h.lastVariables()).toEqual({ identifier: "home" });
  });

  it("reads blocks by identifiers and returns the items", async () => {
    const h = buildToolHarness(cmsTools, data({ cmsBlocks: { items: [{ identifier: "footer", title: "Footer" }] } }));
    expect(await h.call("magentographql_get_cms_blocks", { identifiers: ["footer"] })).toEqual([{ identifier: "footer", title: "Footer" }]);
    expect(h.lastVariables()).toEqual({ identifiers: ["footer"] });
  });

  it("drops the null entries Magento returns for blocks that do not exist, keeping its message", async () => {
    const { double, ...h } = buildToolHarness(cmsTools, { status: 200, body: { data: { cmsBlocks: { items: [null, { identifier: "footer", title: "F" }] } }, errors: [{ message: 'The CMS block with the "x" ID doesn\'t exist.' }] } });
    expect(await h.call("magentographql_get_cms_blocks", { identifiers: ["x", "footer"] })).toEqual({ data: [{ identifier: "footer", title: "F" }], errors: ['The CMS block with the "x" ID doesn\'t exist.'] });
    expect(double.calls).toHaveLength(1);
  });

  it.each([[{ identifier: "" }], [{ identifier: "a".repeat(101) }]])("refuses a page identifier %j", async (args) => {
    const h = buildToolHarness(cmsTools, data({}));
    await expect(h.call("magentographql_get_cms_page", args)).rejects.toThrow();
  });

  it("limits the number of blocks", async () => {
    const h = buildToolHarness(cmsTools, data({}));
    await expect(h.call("magentographql_get_cms_blocks", { identifiers: Array.from({ length: 21 }, (_, i) => `b${i}`) })).rejects.toThrow();
    await expect(h.call("magentographql_get_cms_blocks", { identifiers: [] })).rejects.toThrow();
  });
});

describe("storeTools", () => {
  it("exposes five read tools", () => {
    expect(buildToolHarness(storeTools, data({})).tools.map((t) => t.name).sort()).toEqual([
      "magentographql_get_available_stores",
      "magentographql_get_countries",
      "magentographql_get_country",
      "magentographql_get_currency",
      "magentographql_get_store_config",
    ]);
  });

  it.each([
    ["magentographql_get_store_config", {}, { storeConfig: { store_code: "default" } }, { store_code: "default" }],
    ["magentographql_get_available_stores", {}, { availableStores: [{ store_code: "default" }] }, [{ store_code: "default" }]],
    ["magentographql_get_countries", {}, { countries: [{ id: "ES" }] }, [{ id: "ES" }]],
    ["magentographql_get_currency", {}, { currency: { base_currency_code: "EUR" } }, { base_currency_code: "EUR" }],
  ])("%s returns the right block", async (name, args, body, expected) => {
    expect(await buildToolHarness(storeTools, data(body)).call(name, args)).toEqual(expected);
  });

  it("reads one country by its id", async () => {
    const h = buildToolHarness(storeTools, data({ country: { id: "ES", available_regions: [{ code: "M" }] } }));
    await h.call("magentographql_get_country", { id: "ES" });
    expect(h.lastVariables()).toEqual({ id: "ES" });
    await expect(h.call("magentographql_get_country", { id: "es" })).rejects.toThrow();
  });

  it("never selects the store's secret-looking settings", () => {
    const config = buildToolHarness(storeTools, data({})).tool("magentographql_get_store_config").document ?? "";
    expect(config).not.toMatch(/secure|key|secret|password|token/i);
  });
});
