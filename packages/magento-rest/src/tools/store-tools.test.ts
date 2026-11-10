// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createMagentoRestClient } from "../client/index.js";
import { createFetchDouble, json, type RouteTable } from "../testing/fetch-double.js";
import { LEAK_PROBE_VALUE, injectLeakProbe } from "../testing/leak-probe.js";
import { createToolFactory } from "./rest-tool.js";
import { storeTools } from "./store-tools.js";

const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };

const FIXTURES: ReadonlyArray<readonly [tool: string, path: string, body: unknown, expectedKey: string]> = [
  ["magentorest_get_store_configs", "/store/storeConfigs", [{ id: 1, code: "demo_store", website_id: 1, locale: "en_US", base_currency_code: "EUR", timezone: "UTC" }], "code"],
  ["magentorest_get_store_views", "/store/storeViews", [{ id: 1, code: "demo_store", name: "Demo", website_id: 1, store_group_id: 1, is_active: true }], "name"],
  ["magentorest_get_websites", "/store/websites", [{ id: 1, code: "base", name: "Main Website", default_group_id: 1 }], "name"],
  ["magentorest_get_store_groups", "/store/storeGroups", [{ id: 1, website_id: 1, root_category_id: 2, default_store_id: 1, name: "Main", code: "main" }], "root_category_id"],
  ["magentorest_get_countries", "/directory/countries", [{ id: "ES", two_letter_abbreviation: "ES", full_name_english: "Spain", available_regions: [{ id: 1, code: "M", name: "Madrid" }] }], "full_name_english"],
  [
    "magentorest_get_currency_info",
    "/directory/currency",
    { base_currency_code: "EUR", default_display_currency_code: "EUR", available_currency_codes: ["EUR", "USD"], exchange_rates: [{ currency_to: "USD", rate: 1.1 }] },
    "base_currency_code",
  ],
];

function build(routes: RouteTable) {
  const double = createFetchDouble(routes);
  const client = createMagentoRestClient({
    fetch: double.fetch,
    now: () => 0,
    sleep: async () => {},
    baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
    tokenProvider: new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy }),
  });
  return { double, tools: storeTools(createToolFactory(() => client)) };
}

describe("storeTools", () => {
  it("exposes exactly the six read tools and no write", () => {
    const { tools } = build({});
    expect(tools.map((t) => t.name).sort()).toEqual(FIXTURES.map(([name]) => name).sort());
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });

  it.each(FIXTURES)("%s reads %s and returns only allowlisted fields", async (toolName, path, body, expectedKey) => {
    const { tools } = build({ [`GET /rest/V1${path}`]: json(200, injectLeakProbe(body)) });
    const tool = tools.find((t) => t.name === toolName);
    const text = (await tool?.invoke({}, {}))?.content[0]?.text ?? "";
    expect(text).toContain(expectedKey);
    expect(text).not.toContain(LEAK_PROBE_VALUE);
  });

  it("takes no arguments and rejects any", async () => {
    const { tools } = build({});
    await expect(tools[0]?.invoke({ store: "x" }, {})).rejects.toThrow();
  });
});
