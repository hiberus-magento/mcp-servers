// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The generated operations go through the same factory as the hand-written tools; this pins what generation adds:
// arguments become variables under the schema's own names, the schema's input types are enforced (nested, strict,
// required, enums), the effect fixes the annotations, and the descriptions carry the warnings.
import { describe, expect, it } from "vitest";
import { data } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { GENERATED_OPERATIONS } from "./generated/schema-tools.js";
import { GENERATED_GROUP_NAMES, generatedTools } from "./generated-tools.js";
import { GROUP_NAMES } from "./index.js";

const all = (): ReturnType<typeof buildToolHarness> => buildToolHarness((f) => GENERATED_GROUP_NAMES.flatMap((g) => generatedTools(g)(f)), data({}));
const CART = "AbC123xyz";

describe("generated operations", () => {
  it("cover 193 operations, each in a group the server knows, with a unique name and a fixed document", () => {
    expect(GENERATED_OPERATIONS).toHaveLength(193);
    expect(new Set(GENERATED_OPERATIONS.map((o) => o.name)).size).toBe(193);
    for (const o of GENERATED_OPERATIONS) {
      expect(GROUP_NAMES, o.name).toContain(o.group);
      expect(o.document, o.name).toContain(o.operation);
      expect(o.document, o.name).not.toContain("${");
    }
  });

  it("passes the arguments as variables under the schema's names, and the store as a header", async () => {
    const h = buildToolHarness((f) => generatedTools("checkout")(f), data({ setGuestEmailOnCart: { cart: { id: CART } } }));
    await h.call("magentographql_set_guest_email_on_cart", { input: { cart_id: CART, email: "shopper@demo-host.example" }, store: "de_de" });
    expect(h.lastVariables()).toEqual({ input: { cart_id: CART, email: "shopper@demo-host.example" } });
    expect(h.double.calls[0]?.headers["store"]).toBe("de_de");
    expect(h.double.calls[0]?.request?.query).not.toContain("shopper@demo-host.example");
  });

  it("enforces the schema's input types: required, nested, unknown keys and enums", async () => {
    const h = all();
    await expect(h.call("magentographql_set_guest_email_on_cart", {})).rejects.toThrow();
    await expect(h.call("magentographql_set_guest_email_on_cart", { input: { cart_id: CART } })).rejects.toThrow();
    await expect(h.call("magentographql_set_guest_email_on_cart", { input: { cart_id: CART, email: "a@b.example", extra: 1 } })).rejects.toThrow();
    await expect(h.call("magentographql_set_guest_email_on_cart", { input: { cart_id: CART, email: "a@b.example" }, unknown: 1 })).rejects.toThrow();
    expect(h.double.calls).toHaveLength(0);
  });

  it("reads are read-only queries and mutations are not", () => {
    for (const t of all().tools) expect(t.annotations.readOnlyHint, t.name).toBe(t.access === "read");
    expect(GENERATED_OPERATIONS.filter((o) => o.kind === "query").every((o) => o.effect === "read")).toBe(true);
    expect(GENERATED_OPERATIONS.filter((o) => o.kind === "mutation").every((o) => o.effect !== "read")).toBe(true);
  });

  it.each([
    ["magentographql_place_order", { destructiveHint: true, idempotentHint: false }],
    ["magentographql_delete_wishlist", { destructiveHint: true, idempotentHint: true }],
    ["magentographql_create_wishlist", { destructiveHint: false, idempotentHint: false }],
    ["magentographql_set_shipping_methods_on_cart", { destructiveHint: true, idempotentHint: true }],
    ["magentographql_cancel_order", { destructiveHint: true, idempotentHint: false }],
  ])("%s has the annotations of its effect", (name, expected) => {
    expect(all().tool(name).annotations).toMatchObject({ readOnlyHint: false, ...expected });
  });

  it("warns, in the description, about what an agent must know before calling", () => {
    const h = all();
    expect(h.tool("magentographql_place_order").description).toMatch(/real order/);
    expect(h.tool("magentographql_generate_customer_token").description).toMatch(/password.*conversation/);
    expect(h.tool("magentographql_generate_customer_token").description).toMatch(/credential into the conversation/);
    expect(h.tool("magentographql_create_customer_v2").description).toMatch(/password/);
    expect(h.tool("magentographql_create_wishlist").description).toMatch(/customer token/i);
    expect(h.tool("magentographql_create_company").description).toMatch(/Adobe Commerce only/);
  });

  it("selects only what the document names: no password-shaped field reaches an answer", () => {
    for (const o of GENERATED_OPERATIONS) expect(o.document.replace(/\([^()]*\)/g, "").replace(/^[^{]*\{\s*\w+/, ""), o.name).not.toMatch(/password|secret|cvv|card_number|api_key/i);
  });
});
