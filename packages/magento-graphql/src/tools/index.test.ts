// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The assembled surface and the ONE place the write switch is enforced; plus the
// repository-wide checks over every shipped document (design D3).
import { describe, expect, it } from "vitest";
import { GROUP_NAMES, allMagentoGraphqlTools, assertUniqueNames, createMagentoGraphqlTools, parseGroups } from "./index.js";
import { inspectDocument, MAX_SELECTION_DEPTH } from "../client/index.js";

const getRuntime = () => {
  throw new Error("no runtime in this test");
};
const all = allMagentoGraphqlTools();

describe("createMagentoGraphqlTools", () => {
  it("registers no write tool with the switch off, and every write with it on", () => {
    const off = createMagentoGraphqlTools({ getRuntime, writesEnabled: false });
    expect(off.every((t) => t.access === "read")).toBe(true);
    const on = createMagentoGraphqlTools({ getRuntime, writesEnabled: true });
    expect(on.map((t) => t.name).sort()).toEqual(all.map((t) => t.name).sort());
    expect(on.filter((t) => t.access === "write")).toHaveLength(all.filter((t) => t.access === "write").length);
    expect(all.filter((t) => t.access === "write").length).toBeGreaterThan(100);
  });

  it("loads only the chosen groups", () => {
    const names = createMagentoGraphqlTools({ getRuntime, writesEnabled: true, groups: ["cms", "query"] }).map((t) => t.name);
    expect(names.sort()).toEqual(["magentographql_describe_type", "magentographql_get_cms_blocks", "magentographql_get_cms_page", "magentographql_list_operations", "magentographql_query"]);
  });

  it("keeps a group's reads when its writes are off", () => {
    expect(createMagentoGraphqlTools({ getRuntime, writesEnabled: false, groups: ["cart"] }).map((t) => t.name)).toEqual(["magentographql_get_cart"]);
  });

  it("names the twenty groups", () => {
    expect([...GROUP_NAMES].sort()).toEqual([
      "account", "cart", "categories", "checkout", "cms", "company", "compare", "customer", "gift-and-rewards", "gift-registry",
      "orders", "payments", "products", "purchase-orders", "query", "quotes", "requisition-lists", "returns", "store", "wishlist",
    ]);
  });

  it("throws on an unknown group, listing the valid ones", () => {
    expect(() => parseGroups("products,nope")).toThrow(/nope.*Valid groups/);
    expect(() => createMagentoGraphqlTools({ getRuntime, writesEnabled: false, groups: ["nope"] })).toThrow(/nope/);
  });

  it("refuses duplicate names", () => {
    expect(() => assertUniqueNames([all[0] as never, all[0] as never])).toThrow(/Duplicate/);
  });
});

describe("every shipped tool", () => {
  it("has the magentographql_ prefix, a `Use this` description, and unique names", () => {
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    for (const t of all) {
      expect(t.name, t.name).toMatch(/^magentographql_[a-z0-9_]+$/);
      expect(t.description, t.name).toMatch(/^Use this /);
    }
  });

  it("reads are annotated read-only and writes are not, exactly by access", () => {
    for (const t of all) expect(t.annotations.readOnlyHint, t.name).toBe(t.access === "read");
  });

  it("holds a document that is one operation of the right kind, within the depth limit", () => {
    for (const t of all.filter((tool) => tool.document !== undefined)) {
      const info = inspectDocument(t.document ?? "");
      expect(info.operations, t.name).toBe(1);
      expect(info.kind, t.name).toBe(t.access === "read" ? "query" : "mutation");
      expect(info.depth, t.name).toBeLessThanOrEqual(MAX_SELECTION_DEPTH);
    }
  });

  // Operations that exist to hand a token or a payment reference back (generateCustomerToken, createPaypalExpressToken,
  // vault tokens) select it by name, so `token` and `hash` are not banned; what no document may ask for is a secret.
  // Only what is SELECTED counts: an operation may take a password as an argument (changeCustomerPassword), which sits
  // inside the parentheses and is removed here; the descriptions of those tools say that it passes through the conversation.
  it("selects no password, secret, card number, CVV or key", () => {
    const selected = (document: string): string => document.replace(/\([^()]*\)/g, "").match(/\{\s*\w+\s*(\{[\s\S]*\})\s*\}\s*$/)?.[1] ?? "";
    expect(all.filter((t) => selected(t.document ?? "") !== "").length).toBeGreaterThan(180);
    for (const t of all) expect(selected(t.document ?? ""), t.name).not.toMatch(/password|secret|cvv|api_key|card_number|private_key|iban/i);
  });

  it("gives every mutation a mutation document and every query a query document, and a group", () => {
    for (const t of all.filter((tool) => tool.document !== undefined)) expect(t.document?.trim(), t.name).toMatch(t.access === "read" ? /^query / : /^mutation /);
  });

  it("never interpolates: every document takes its values from variables", () => {
    for (const t of all) expect(t.document ?? "", t.name).not.toMatch(/\$\{/);
  });
});
