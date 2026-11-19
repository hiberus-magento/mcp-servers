// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The assembled surface is where the write switch is enforced, so
// it is tested as a whole: what the server registers with the switch off,
// what it registers with it on, and the invariants every tool must satisfy.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_SKUS, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createMagentoRestClient } from "../client/index.js";
import { createFetchDouble, json } from "../testing/fetch-double.js";
import { createDatabaseAccess, type DatabaseAccess } from "../db/access.js";
import { GROUP_NAMES, allMagentoRestTools, assertUniqueNames, createMagentoRestTools, parseGroups } from "./index.js";
import type { MagentoRestRuntime } from "./runtime.js";

const getRuntime = (): MagentoRestRuntime => {
  throw new Error("the client must not be resolved while the surface is assembled");
};

describe("createMagentoRestTools", () => {
  it("registers NO write tool while the switch is off", () => {
    const tools = createMagentoRestTools({ getRuntime, writesEnabled: false });
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((t) => t.access === "write")).toEqual([]);
  });

  it("registers the write tools too when the switch is on, and every read tool in both modes", () => {
    const off = createMagentoRestTools({ getRuntime, writesEnabled: false });
    const on = createMagentoRestTools({ getRuntime, writesEnabled: true });
    expect(on.filter((t) => t.access === "write").length).toBeGreaterThan(0);
    expect(on.filter((t) => t.access === "read").map((t) => t.name)).toEqual(off.map((t) => t.name));
  });

  it("does not resolve the client while assembling (tools/list must work before configuration)", () => {
    expect(() => createMagentoRestTools({ getRuntime, writesEnabled: true })).not.toThrow();
  });
});

const database = (writes: boolean): DatabaseAccess =>
  createDatabaseAccess({
    target: { host: "127.0.0.1", port: 3306, user: "reader", database: "shop", ssl: false },
    getPassword: () => {
      throw new Error("the password must not be resolved while the surface is assembled");
    },
    writesEnabled: writes,
  });

describe("tool groups", () => {
  const names = (groups?: readonly string[]): string[] =>
    createMagentoRestTools({ getRuntime, writesEnabled: true, ...(groups !== undefined ? { groups } : {}) }).map((t) => t.name);
  const restNames = (): string[] => allMagentoRestTools().map((t) => t.name).filter((n) => !n.startsWith("magentorest_db_"));

  it("loads every REST group when none is chosen, and no database tool without a database", () => {
    expect(names()).toEqual(restNames());
    expect(names([])).toEqual(names());
  });

  it("loads only the tools of the chosen groups", () => {
    const chosen = names(["customers", "products"]);
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThan(names().length);
    expect(chosen.every((n) => /customer|product/.test(n))).toBe(true);
    expect(chosen.some((n) => n.includes("customer"))).toBe(true);
    expect(chosen.some((n) => n.includes("product"))).toBe(true);
  });

  it("partitions the surface: every REST tool belongs to exactly one group", () => {
    const perGroup = GROUP_NAMES.filter((g) => g !== "database").flatMap((g) => names([g]));
    expect(perGroup.slice().sort()).toEqual(names().slice().sort());
  });

  it("still applies the write switch inside a chosen group", () => {
    const off = createMagentoRestTools({ getRuntime, writesEnabled: false, groups: ["customers"] });
    expect(off.length).toBeGreaterThan(0);
    expect(off.filter((t) => t.access === "write")).toEqual([]);
  });

  it("refuses an unknown group, naming it and the valid ones", () => {
    expect(() => createMagentoRestTools({ getRuntime, writesEnabled: false, groups: ["custmers"] })).toThrow(/custmers.*customers/s);
  });
});

describe("the database group", () => {
  const make = (extra: Partial<Parameters<typeof createMagentoRestTools>[0]>) => createMagentoRestTools({ getRuntime, writesEnabled: false, ...extra }).map((t) => t.name);
  const dbNames = (names: readonly string[]) => names.filter((n) => n.startsWith("magentorest_db_"));

  it("is in the group list", () => {
    expect(GROUP_NAMES).toContain("database");
  });

  it("is loaded with every other group when a database is configured and no group is chosen", () => {
    const names = make({ database: database(false) });
    expect(dbNames(names)).toHaveLength(8);
    expect(names.length).toBeGreaterThan(dbNames(names).length);
  });

  it("is the only thing loaded when it is the only group chosen", () => {
    const names = make({ database: database(false), groups: ["database"] });
    expect(names).toEqual(dbNames(names));
    expect(names).toHaveLength(8);
  });

  it("is left out when another group is chosen", () => {
    expect(dbNames(make({ database: database(false), groups: ["customers"] }))).toEqual([]);
  });

  it("has its write tool only with the DATABASE write switch, not the REST one", () => {
    expect(make({ database: database(false), writesEnabled: true, groups: ["database"] })).not.toContain("magentorest_db_execute");
    expect(make({ database: database(true), writesEnabled: false, groups: ["database"] })).toContain("magentorest_db_execute");
  });

  it("is refused when chosen without a database connection, saying what is missing", () => {
    expect(() => make({ groups: ["database"] })).toThrow(/MAGENTO_REST_DATABASE_CONNECTION/);
  });

  it("does not touch the password or the driver while assembling", () => {
    expect(() => make({ database: database(true) })).not.toThrow();
  });
});

describe("parseGroups", () => {
  it("treats unset and blank as no selection", () => {
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups("  ")).toEqual([]);
  });
  it("splits on commas, trims, lowercases and de-duplicates", () => {
    expect(parseGroups(" Products, customers ,products")).toEqual(["products", "customers"]);
  });
  it("rejects an unknown name", () => {
    expect(() => parseGroups("products,nope")).toThrow(/nope/);
  });
});

describe("field configuration", () => {
  const [SKU] = SYNTHETIC_MAGENTO_SKUS;
  const runtime = (): MagentoRestRuntime => {
    const double = createFetchDouble({ [`GET /rest/V1/products/${SKU}`]: json(200, { sku: SKU, name: "Demo Tent", cost: 12, password_hash: "do-not-leak" }) });
    const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };
    return {
      client: createMagentoRestClient({
        fetch: double.fetch,
        now: () => 0,
        sleep: async () => {},
        baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
        tokenProvider: new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy }),
      }),
    };
  };
  const callProduct = async (fieldConfig?: Parameters<typeof createMagentoRestTools>[0]["fieldConfig"]): Promise<Record<string, unknown>> => {
    const tools = createMagentoRestTools({ getRuntime: runtime, writesEnabled: false, ...(fieldConfig !== undefined ? { fieldConfig } : {}) });
    const tool = tools.find((t) => t.name === "magentorest_get_product_by_sku");
    return JSON.parse((await tool?.invoke({ sku: SKU }, {}))?.content[0]?.text ?? "{}") as Record<string, unknown>;
  };

  it("without a configuration, a field outside the shipped list does not reach the caller", async () => {
    expect(await callProduct()).toEqual({ sku: SKU, name: "Demo Tent" });
  });

  it("with one, the added field reaches the caller, and nothing else new does", async () => {
    expect(await callProduct({ product: { add: ["cost"] } })).toEqual({ sku: SKU, name: "Demo Tent", cost: 12 });
  });

  it("a removal takes the field away from what the caller receives", async () => {
    expect(await callProduct({ product: { remove: ["name"] } })).toEqual({ sku: SKU });
  });

  it("an empty configuration changes nothing", async () => {
    expect(await callProduct({})).toEqual({ sku: SKU, name: "Demo Tent" });
  });

  it("leaves a resource the file does not name untouched", async () => {
    expect(await callProduct({ website: { add: ["sort_order"] } })).toEqual({ sku: SKU, name: "Demo Tent" });
  });
});

describe("tools that are deliberately not offered", () => {
  // Each of these called a route that a live Magento does not have as the original assumed, so the tool could only
  // ever fail: shipping and payment methods are per cart, `/orders/statuses` is read as `/orders/{id}`, and
  // `/url-rewrite` is not a core endpoint (404 on a stock 2.4.8). Shipping a tool that cannot work is worse than
  // not shipping it, and this keeps one from being added back unnoticed.
  it.each(["magentorest_get_shipping_methods", "magentorest_get_payment_methods", "magentorest_get_order_statuses", "magentorest_search_url_rewrites"])("does not offer %s", (name) => {
    expect(allMagentoRestTools().map((t) => t.name)).not.toContain(name);
  });
});

describe("every tool", () => {
  const tools = allMagentoRestTools();

  it("is a non-empty set, so the per-tool checks below cannot pass by iterating nothing", () => {
    expect(tools.length).toBeGreaterThan(10);
  });

  it("has a unique, prefixed, snake_case name and a non-empty description", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^magentorest_[a-z0-9_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("carries read-only hints exactly when it is a read tool, and never both read-only and destructive", () => {
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(tool.access === "read");
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint, tool.name).toBe(false);
        expect(tool.annotations.idempotentHint, tool.name).toBe(true);
      }
    }
  });

  it("accepts only a strict input object", () => {
    for (const tool of tools) {
      expect(() => tool.inputSchema.parse({ definitely_not_a_declared_argument: 1 }), tool.name).toThrow();
    }
  });
});

describe("assertUniqueNames", () => {
  it("throws, naming the duplicate", () => {
    const [first] = allMagentoRestTools();
    if (first === undefined) throw new Error("no tools");
    expect(() => assertUniqueNames([first, first])).toThrow(first.name);
  });
});
