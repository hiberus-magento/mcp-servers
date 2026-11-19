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
  it("cover 224 operations, each in a group the server knows, with a unique name and a fixed document", () => {
    expect(GENERATED_OPERATIONS).toHaveLength(224);
    expect(new Set(GENERATED_OPERATIONS.map((o) => o.name)).size).toBe(224);
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

  it("requires `input` only when the input type has a required field", async () => {
    const h = buildToolHarness((f) => GENERATED_GROUP_NAMES.flatMap((g) => generatedTools(g)(f)), data({ createGuestCart: { cart: { id: CART } } }));
    // createGuestCart's input has only optional fields, so an empty call is a real call...
    expect(await h.call("magentographql_create_guest_cart", {})).toEqual({ cart: { id: CART } });
    expect(h.lastVariables()).toEqual({});
    // ...while setGuestEmailOnCart's input has required fields, so an empty call is not.
    await expect(h.call("magentographql_set_guest_email_on_cart", {})).rejects.toThrow();
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
    // Every call sends another email, so twice is not the same as once.
    ["magentographql_resend_confirmation_email", { destructiveHint: true, idempotentHint: false }],
    // Operations of the latest Adobe Commerce + B2B schema, placed on purpose (design D14).
    ["magentographql_unsubscribe_product_alert_price", { destructiveHint: true, idempotentHint: true }],
    ["magentographql_unassign_child_company", { destructiveHint: true, idempotentHint: true }],
    ["magentographql_select_free_gift_for_cart", { destructiveHint: true, idempotentHint: true }],
    ["magentographql_import_shared_requisition_list", { destructiveHint: false, idempotentHint: false }],
    ["magentographql_create_braintree_client_token", { destructiveHint: true, idempotentHint: false }],
    ["magentographql_share_requisition_list_by_email", { destructiveHint: true, idempotentHint: false }],
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
    expect(h.tool("magentographql_exchange_otp_for_customer_token").description).toMatch(/credential into the conversation/);
    expect(h.tool("magentographql_place_negotiable_quote_order_v2").description).toMatch(/real order/);
    expect(h.tool("magentographql_subscribe_product_alert_stock").description).toMatch(/customer token/i);
    // A public requisition list is read by its token, without a signed-in customer.
    expect(h.tool("magentographql_get_public_requisition_list").description).not.toMatch(/customer token/i);
  });

  it("places every operation of the latest Adobe Commerce + B2B schema in the group of its area", () => {
    const groupOf = (operation: string): string | undefined => GENERATED_OPERATIONS.find((o) => o.operation === operation)?.group;
    expect(groupOf("subscribeProductAlertPrice")).toBe("product-alerts");
    expect(groupOf("isSubscribedProductAlertStock")).toBe("product-alerts");
    expect(groupOf("reviews")).toBe("products");
    expect(groupOf("inventoryAvailability")).toBe("products");
    expect(groupOf("commerceOptimizer")).toBe("store");
    expect(groupOf("createBraintreeClientToken")).toBe("payments");
    expect(groupOf("exchangeOtpForCustomerToken")).toBe("account");
    expect(groupOf("selectFreeGiftForCart")).toBe("cart");
    expect(groupOf("createCompanyAddress")).toBe("company");
    expect(groupOf("shareRequisitionListByToken")).toBe("requisition-lists");
    expect(groupOf("placeNegotiableQuoteOrderV2")).toBe("quotes");
  });

  it("selects only what the document names: no password-shaped field reaches an answer", () => {
    for (const o of GENERATED_OPERATIONS) expect(o.document.replace(/\([^()]*\)/g, "").replace(/^[^{]*\{\s*\w+/, ""), o.name).not.toMatch(/password|secret|cvv|card_number|api_key/i);
  });
});
