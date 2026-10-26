// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `invoices.js`, `shipments.js` and
// `creditmemos.js`. These hold the writes that move money or goods —
// capturing a payment, shipping, refunding — so the cases that matter most are
// about what is sent (a refund's adjustments belong inside `arguments`, which
// the original got wrong), what can never be replayed, and what the schemas
// refuse (an empty line list, a zero or negative quantity).
import { SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { salesDocumentTools } from "./sales-documents-tools.js";

const INCREMENT = SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID;
const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(salesDocumentTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const LINES = [{ order_item_id: 1, qty: 2 }];

describe("salesDocumentTools surface", () => {
  it("exposes six reads and four writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_creditmemo_by_id",
      "magentorest_get_invoice_by_id",
      "magentorest_get_shipment_by_id",
      "magentorest_search_creditmemos",
      "magentorest_search_invoices",
      "magentorest_search_shipments",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual([
      "magentorest_add_shipment_tracking",
      "magentorest_create_creditmemo",
      "magentorest_create_invoice",
      "magentorest_create_shipment",
    ]);
  });
});

describe.each([
  ["invoice", "/invoices", "magentorest_get_invoice_by_id", "invoice_id", "magentorest_search_invoices", true],
  ["shipment", "/shipment", "magentorest_get_shipment_by_id", "shipment_id", "magentorest_search_shipments", false],
  ["creditmemo", "/creditmemo", "magentorest_get_creditmemo_by_id", "creditmemo_id", "magentorest_search_creditmemos", true],
] as const)("%s reads", (kind, getPath, getName, idKey, searchName, hasState) => {
  const raw = { entity_id: 3, order_id: 4, increment_id: INCREMENT, state: 2, grand_total: 126, total_qty: 2, transaction_id: "txn-secret", items: [{ entity_id: 1, order_item_id: 1, sku: "DEMO-TENT-001", name: "Demo Tent", qty: 2, hidden_cost: 5 }], tracks: [{ entity_id: 1, parent_id: 3, carrier_code: "custom", title: "Courier", track_number: "TRK1", secret: "x" }] };
  const searchPath = kind === "shipment" ? "/shipments" : kind === "invoice" ? "/invoices" : "/creditmemos";

  it(`${getName} reads one ${kind} by ID, projected, without the transaction id`, async () => {
    const getRoute = kind === "invoice" ? "/invoices/3" : `${getPath}/3`;
    const { call } = build({ [`GET /rest/V1${getRoute}`]: json(200, injectLeakProbe(raw)) });
    const out = (await call(getName, { [idKey]: 3 })) as Record<string, unknown>;
    expect(out["entity_id"]).toBe(3);
    expect(out["order_id"]).toBe(4);
    const text = JSON.stringify(out);
    for (const hidden of ["txn-secret", "hidden_cost", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it(`${getName} refuses a non-positive ID before any request`, async () => {
    const { double, tool } = build({});
    await expect(tool(getName).invoke({ [idKey]: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it(`${searchName} combines filters with AND, widens dates to whole days, and bounds the page`, async () => {
    const { double, call } = build({ [`GET /rest/V1${searchPath}`]: json(200, { items: [], total_count: 0 }) });
    await call(searchName, { order_id: 4, ...(hasState ? { state: 2 } : {}), date_from: "2026-01-01", date_to: "2026-01-31" });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["order_id", "4", "eq"]);
    const next = hasState ? 2 : 1;
    if (hasState) expect([f(1, "field"), f(1, "value")]).toEqual(["state", "2"]);
    expect([f(next, "field"), f(next, "value"), f(next, "condition_type")]).toEqual(["created_at", "2026-01-01 00:00:00", "gteq"]);
    expect([f(next + 1, "field"), f(next + 1, "value"), f(next + 1, "condition_type")]).toEqual(["created_at", "2026-01-31 23:59:59", "lteq"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("20");
  });

  it(`${searchName} returns summaries only`, async () => {
    const { call } = build({ [`GET /rest/V1${searchPath}`]: json(200, injectLeakProbe({ items: [raw], total_count: 1 })) });
    const out = (await call(searchName, {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(out.items[0]).not.toHaveProperty("items");
    expect(out.items[0]).not.toHaveProperty("transaction_id");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it(`${searchName} refuses a bad date and a page size above 100`, async () => {
    const { tool } = build({});
    await expect(tool(searchName).invoke({ date_from: "yesterday" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool(searchName).invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });

  if (hasState) {
    it(`${searchName} refuses a state outside 1..3`, async () => {
      const { tool } = build({});
      await expect(tool(searchName).invoke({ state: 4 }, {})).rejects.toBeInstanceOf(ZodError);
      await expect(tool(searchName).invoke({ state: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    });
  } else {
    it(`${searchName} takes no state filter`, async () => {
      const { tool } = build({});
      await expect(tool(searchName).invoke({ state: 1 }, {})).rejects.toBeInstanceOf(ZodError);
    });
  }
});

describe("magentorest_get_shipment_by_id keeps the tracks", () => {
  it("returns the tracking entries, projected", async () => {
    const raw = { entity_id: 3, order_id: 4, tracks: [{ entity_id: 1, parent_id: 3, carrier_code: "custom", title: "Courier", track_number: "TRK1", secret: "x" }] };
    const { call } = build({ "GET /rest/V1/shipment/3": json(200, injectLeakProbe(raw)) });
    const out = (await call("magentorest_get_shipment_by_id", { shipment_id: 3 })) as { tracks: Record<string, unknown>[] };
    expect(out.tracks[0]?.["track_number"]).toBe("TRK1");
    expect(out.tracks[0]).not.toHaveProperty("secret");
  });
});

describe("magentorest_create_invoice", () => {
  it("defaults to NOT capturing payment and NOT notifying, and sends no line list when none is given", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/invoice": json(200, 12) });
    expect(await call("magentorest_create_invoice", { order_id: 4 })).toBe(12);
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ capture: false, notify: false });
  });

  it("sends capture, notify and the lines when asked", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/invoice": json(200, 12) });
    await call("magentorest_create_invoice", { order_id: 4, capture: true, notify_customer: true, items: LINES });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ capture: true, notify: true, items: LINES });
  });

  it.each([[[]], [[{ order_item_id: 1, qty: 0 }]], [[{ order_item_id: 1, qty: -1 }]], [[{ order_item_id: 0, qty: 1 }]], [[{ order_item_id: 1, qty: 1, extra: 1 }]], [Array.from({ length: 101 }, (_, i) => ({ order_item_id: i + 1, qty: 1 }))]])(
    "refuses the line list %#",
    async (items) => {
      const { double, tool } = build({});
      await expect(tool("magentorest_create_invoice").invoke({ order_id: 4, items }, {})).rejects.toBeInstanceOf(ZodError);
      expect(double.calls).toHaveLength(0);
    },
  );

  it("says in its description that capture charges the customer", () => {
    expect(build({}).tool("magentorest_create_invoice").description).toMatch(/capture/i);
  });
});

describe("magentorest_create_shipment", () => {
  it("defaults to not notifying and sends no lines or tracks when none are given", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/ship": json(200, 8) });
    expect(await call("magentorest_create_shipment", { order_id: 4 })).toBe(8);
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ notify: false });
  });

  it("sends lines and tracking when given", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/ship": json(200, 8) });
    const tracks = [{ carrier_code: "custom", title: "Courier", track_number: "TRK1" }];
    await call("magentorest_create_shipment", { order_id: 4, notify_customer: true, items: LINES, tracks });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ notify: true, items: LINES, tracks });
  });

  it.each([[{ carrier_code: "a b", title: "T", track_number: "1" }], [{ carrier_code: "ups", title: "", track_number: "1" }], [{ carrier_code: "ups", title: "T", track_number: "" }]])("refuses the track %#", async (track) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_create_shipment").invoke({ order_id: 4, tracks: [track] }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_create_shipment explains its commonest failure", () => {
  // Observed live: on a store with multi-source inventory a shipment for a product with no stock in the source is
  // answered 400 "Could not save a shipment, see error log for details"; only Magento's log says why ("Not all of
  // your products are available in the requested quantity"). A caller that sees only the first message cannot tell.
  it("says that a product with no stock in its source cannot be shipped", () => {
    const description = build({}).tool("magentorest_create_shipment").description;
    expect(description).toMatch(/stock/i);
    expect(description).toMatch(/Could not save a shipment/);
  });
});

describe("magentorest_add_shipment_tracking", () => {
  // Found against a live 2.4.8-p5: POSTing `{ entity: { carrier_code, title, track_number, parent_id } }` is answered
  // 400 "Could not save the shipment tracking." — the track row also needs the shipment's `order_id`, which the
  // original never sent, so its tool never worked. With `order_id` the same call returns 200. The caller only has the
  // shipment ID, so the shipment is read first and its order is sent along.
  const routes = (shipment: object = { entity_id: 3, order_id: 4 }) => ({
    "GET /rest/V1/shipment/3": json(200, shipment),
    "POST /rest/V1/shipment/track": json(200, injectLeakProbe({ entity_id: 5, parent_id: 3, order_id: 4, carrier_code: "ups", title: "UPS", track_number: "TRK9", created_at: "2026-01-01 00:00:00" })),
  });

  it("reads the shipment, then POSTs the track with the shipment's order_id, and returns the projected track", async () => {
    const { double, call } = build(routes());
    const out = (await call("magentorest_add_shipment_tracking", { shipment_id: 3, carrier_code: "ups", title: "UPS", track_number: "TRK9" })) as Record<string, unknown>;
    expect(double.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ entity: { carrier_code: "ups", title: "UPS", track_number: "TRK9", parent_id: 3, order_id: 4 } });
    expect(out["track_number"]).toBe("TRK9");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("refuses, without posting, when the shipment does not report its order", async () => {
    const { double, tool } = build(routes({ entity_id: 3 }));
    await expect(tool("magentorest_add_shipment_tracking").invoke({ shipment_id: 3, carrier_code: "ups", title: "UPS", track_number: "T" }, {})).rejects.toThrow(/order/i);
    expect(double.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("reports a shipment that does not exist as the 404 it is, without posting", async () => {
    const { double, tool } = build({ "GET /rest/V1/shipment/3": json(404, { message: "The entity that was requested doesn't exist." }) });
    await expect(tool("magentorest_add_shipment_tracking").invoke({ shipment_id: 3, carrier_code: "ups", title: "UPS", track_number: "T" }, {})).rejects.toMatchObject({ kind: "not-found" });
    expect(double.calls).toHaveLength(1);
  });
});

describe("magentorest_create_creditmemo", () => {
  it("defaults to not notifying and sends only what was asked", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/refund": json(200, 6) });
    expect(await call("magentorest_create_creditmemo", { order_id: 4 })).toBe(6);
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ notify: false });
  });

  it("puts shipping and adjustments inside `arguments`, where Magento reads them — the original sent them at the top level", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/refund": json(200, 6) });
    await call("magentorest_create_creditmemo", { order_id: 4, notify_customer: true, items: LINES, adjustment_positive: 5, adjustment_negative: 2, shipping_amount: 7 });
    const body = JSON.parse(double.calls[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body).toEqual({ notify: true, items: LINES, arguments: { adjustment_positive: 5, adjustment_negative: 2, shipping_amount: 7 } });
    expect(body).not.toHaveProperty("adjustment_positive");
    expect(body).not.toHaveProperty("shipping_amount");
  });

  it("omits `arguments` entirely when no amount is given", async () => {
    const { double, call } = build({ "POST /rest/V1/order/4/refund": json(200, 6) });
    await call("magentorest_create_creditmemo", { order_id: 4, items: LINES });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).not.toHaveProperty("arguments");
  });

  it.each([{ adjustment_positive: -1 }, { adjustment_negative: -1 }, { shipping_amount: -1 }, { items: [] }, { items: [{ order_item_id: 1, qty: 0 }] }])("refuses %j before any request", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_create_creditmemo").invoke({ order_id: 4, ...bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("says in its description that it refunds money", () => {
    expect(build({}).tool("magentorest_create_creditmemo").description).toMatch(/refund/i);
  });
});

describe("the writes move money or goods, so none is ever replayed", () => {
  it.each([
    ["magentorest_create_invoice", "POST /rest/V1/order/4/invoice", { order_id: 4 }],
    ["magentorest_create_shipment", "POST /rest/V1/order/4/ship", { order_id: 4 }],
    ["magentorest_create_creditmemo", "POST /rest/V1/order/4/refund", { order_id: 4 }],
    ["magentorest_add_shipment_tracking", "POST /rest/V1/shipment/track", { shipment_id: 3, carrier_code: "ups", title: "UPS", track_number: "T1" }],
  ])("%s is sent once even when Magento answers 503", async (name, route, args) => {
    // The tracking write reads its shipment first; that read succeeds and only the WRITE fails.
    const { double, tool } = build({ "GET /rest/V1/shipment/3": json(200, { entity_id: 3, order_id: 4 }), [route]: json(503, { message: "busy" }) });
    await expect(tool(name).invoke(args, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls.filter((c) => c.method !== "GET")).toHaveLength(1);
  });

  it("invoice, shipment and credit memo are destructive, non-idempotent actions; adding a track only creates", () => {
    const { tool } = build({});
    for (const name of ["magentorest_create_invoice", "magentorest_create_shipment", "magentorest_create_creditmemo"]) {
      expect(tool(name).annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    }
    expect(tool("magentorest_add_shipment_tracking").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });
});
