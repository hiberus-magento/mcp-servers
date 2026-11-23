// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The product content pair a host's content action uses (Kora contract R-20..R-24): a read of the five content
// fields and the image labels as one store view sees them, and a write of only the members given, only in that
// store view, read back afterwards.
import { SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { json, type RecordedCall, type RouteTable } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { PRODUCT_CONTENT_READ_TOOL, PRODUCT_CONTENT_WRITE_TOOL, productContentTools } from "./product-content-tools.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const VIEW = "demo_view";
const PRODUCT_PATH = `/rest/${VIEW}/V1/products/${SKU}`;

const entry = (id: number, label: string | null) => ({ id, media_type: "image", label, position: id, disabled: false, types: id === 1 ? ["image"] : [], file: `/d/e/demo-${id}.jpg` });

function product(overrides: { name?: string; description?: string; meta_title?: string; labels?: [string | null, string | null] } = {}) {
  const custom = [
    { attribute_code: "description", value: overrides.description ?? "<p>Demo tent for two.</p>" },
    { attribute_code: "meta_title", value: overrides.meta_title ?? "Demo tent" },
    { attribute_code: "url_key", value: "demo-tent" },
  ];
  return {
    id: 7,
    sku: SKU,
    name: overrides.name ?? "Demo tent",
    price: 99,
    custom_attributes: custom,
    media_gallery_entries: [entry(1, overrides.labels?.[0] ?? "Front"), entry(2, overrides.labels?.[1] ?? null)],
  };
}

const call = async (harness: ReturnType<typeof buildToolHarness>, name: string, args: unknown) => harness.tool(name).invoke(args, {});

describe(`${PRODUCT_CONTENT_READ_TOOL}`, () => {
  const harness = (routes: RouteTable) => buildToolHarness(productContentTools, routes);

  it("is a read tool with an output schema", () => {
    const tool = harness({}).tool(PRODUCT_CONTENT_READ_TOOL);
    expect(tool.access).toBe("read");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.outputSchema).toBeDefined();
  });

  it("returns the five content fields and the image labels as the store view sees them, null where there is no value", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(200, product()) });
    const result = await call(h, PRODUCT_CONTENT_READ_TOOL, { sku: SKU, store_view: VIEW });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      found: true,
      sku: SKU,
      store_view: VIEW,
      content: { name: "Demo tent", description: "<p>Demo tent for two.</p>", short_description: null, meta_title: "Demo tent", meta_description: null },
      images: [
        { id: "1", file: "/d/e/demo-1.jpg", label: "Front" },
        { id: "2", file: "/d/e/demo-2.jpg", label: null },
      ],
      provenance: { endpoint: `GET ${PRODUCT_PATH}`, api_version: "V1", read_at: "1970-01-01T00:00:00.000Z", store_view: VIEW },
    });
    expect(h.tool(PRODUCT_CONTENT_READ_TOOL).outputSchema?.safeParse(result.structuredContent).success).toBe(true);
  });

  it("an unknown SKU is a result, found: false, with the reference asked for and where it was looked up", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(404, { message: "The product that was requested doesn't exist. Verify the product and try again." }) });
    const result = await call(h, PRODUCT_CONTENT_READ_TOOL, { sku: SKU, store_view: VIEW });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ found: false, sku: SKU, store_view: VIEW, provenance: { endpoint: `GET ${PRODUCT_PATH}`, api_version: "V1", read_at: "1970-01-01T00:00:00.000Z", store_view: VIEW } });
  });

  it("an unknown store view is invalid_argument on store_view, not found: false", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(404, { message: "Request does not match any route." }) });
    await expect(call(h, PRODUCT_CONTENT_READ_TOOL, { sku: SKU, store_view: VIEW })).rejects.toMatchObject({ code: "invalid_argument", argument: "store_view" });
  });

  it.each([undefined, "", "not a code!"])("refuses store_view %j without calling Magento", async (store_view) => {
    const h = harness({});
    await expect(call(h, PRODUCT_CONTENT_READ_TOOL, { sku: SKU, ...(store_view !== undefined ? { store_view } : {}) })).rejects.toMatchObject({ code: "invalid_argument", argument: "store_view" });
    expect(h.double.calls).toHaveLength(0);
  });
});

describe(`${PRODUCT_CONTENT_WRITE_TOOL}`, () => {
  const harness = (routes: RouteTable) => buildToolHarness(productContentTools, routes);
  const puts = (calls: readonly RecordedCall[]) => calls.filter((c) => c.method === "PUT").map((c) => ({ path: new URL(c.url).pathname, body: JSON.parse(c.body ?? "null") as unknown }));

  it("is an idempotent, destructive write with an output schema, and its description states the image side effect and the version", () => {
    const tool = harness({}).tool(PRODUCT_CONTENT_WRITE_TOOL);
    expect(tool.access).toBe("write");
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(tool.outputSchema).toBeDefined();
    expect(tool.description).toMatch(/every image/i);
    expect(tool.description).toMatch(/2\.4\.7/);
  });

  it("sends only the members that differ, only to that store view, then returns the content read back", async () => {
    const h = harness({
      [`GET ${PRODUCT_PATH}`]: [json(200, product()), json(200, product({ meta_title: "Demo tent, two people", labels: ["Front", "Side"] }))],
      [`PUT ${PRODUCT_PATH}`]: json(200, {}),
      [`PUT ${PRODUCT_PATH}/media/2`]: json(200, true),
    });
    const result = await call(h, PRODUCT_CONTENT_WRITE_TOOL, {
      sku: SKU,
      store_view: VIEW,
      content: { name: "Demo tent", meta_title: "Demo tent, two people" },
      images: [{ id: "1", label: "Front" }, { id: "2", label: "Side" }],
    });
    expect(result.isError).toBeFalsy();
    expect(puts(h.double.calls)).toEqual([
      { path: PRODUCT_PATH, body: { product: { sku: SKU, custom_attributes: [{ attribute_code: "meta_title", value: "Demo tent, two people" }] } } },
      { path: `${PRODUCT_PATH}/media/2`, body: { entry: { ...entry(2, null), label: "Side" } } },
    ]);
    expect(result.structuredContent).toMatchObject({
      found: true,
      sku: SKU,
      store_view: VIEW,
      content: { meta_title: "Demo tent, two people" },
      images: [
        { id: "1", label: "Front" },
        { id: "2", label: "Side" },
      ],
    });
    expect(h.tool(PRODUCT_CONTENT_WRITE_TOOL).outputSchema?.safeParse(result.structuredContent).success).toBe(true);
  });

  it("a second identical call sends nothing and returns the same result", async () => {
    const after = product({ meta_title: "Demo tent, two people" });
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(200, after) });
    const first = await call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { meta_title: "Demo tent, two people" } });
    const second = await call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { meta_title: "Demo tent, two people" } });
    expect(puts(h.double.calls)).toEqual([]);
    expect(second.structuredContent).toEqual(first.structuredContent);
  });

  it("a field the store view has no value for is written when given", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(200, product()), [`PUT ${PRODUCT_PATH}`]: json(200, {}) });
    await call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { short_description: "Two-person tent." } });
    expect(puts(h.double.calls)).toEqual([{ path: PRODUCT_PATH, body: { product: { sku: SKU, custom_attributes: [{ attribute_code: "short_description", value: "Two-person tent." }] } } }]);
  });

  it("a changed name goes as the product's name, not as a custom attribute", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(200, product()), [`PUT ${PRODUCT_PATH}`]: json(200, {}) });
    await call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { name: "Demo tent XL" } });
    expect(puts(h.double.calls)).toEqual([{ path: PRODUCT_PATH, body: { product: { sku: SKU, name: "Demo tent XL" } } }]);
  });

  it.each([undefined, "", "all", "ALL", "admin"])("refuses store_view %j with invalid_argument, without calling Magento", async (store_view) => {
    const h = harness({});
    await expect(call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, ...(store_view !== undefined ? { store_view } : {}), content: { name: "x" } })).rejects.toMatchObject({ code: "invalid_argument", argument: "store_view" });
    expect(h.double.calls).toHaveLength(0);
  });

  it.each([
    [{ content: { name: "x".repeat(256) } }, "content.name"],
    [{ content: { meta_title: "x".repeat(256) } }, "content.meta_title"],
    [{ content: { meta_description: "x".repeat(256) } }, "content.meta_description"],
    [{ content: { description: "é".repeat(40_000) } }, "content.description"],
    [{ content: { name: "" } }, "content.name"],
    [{ content: { description: "" } }, "content.description"],
    [{ content: { short_description: "" } }, "content.short_description"],
    [{ content: { meta_title: "" } }, "content.meta_title"],
    [{ content: { meta_description: "" } }, "content.meta_description"],
    [{ images: [{ id: "1", label: "A" }, { id: "1", label: "B" }] }, "images[1].id"],
    [{ images: [{ id: "1", label: "x".repeat(256) }] }, "images[0].label"],
    [{ images: [{ id: "1", label: "" }] }, "images[0].label"],
    [{ images: [{ id: "one", label: "x" }] }, "images[0].id"],
  ])("refuses %j with invalid_argument on %s, before any call", async (change, argument) => {
    const h = harness({});
    await expect(call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, ...change })).rejects.toMatchObject({ code: "invalid_argument", argument });
    expect(h.double.calls).toHaveLength(0);
  });

  it("an unknown SKU is not_found on sku, and no product is created", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(404, { message: "The product that was requested doesn't exist. Verify the product and try again." }) });
    await expect(call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { name: "x" } })).rejects.toMatchObject({ code: "not_found", argument: "sku" });
    expect(puts(h.double.calls)).toEqual([]);
  });

  it("an image id the product does not have is not_found on that image, and nothing is written", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(200, product()) });
    await expect(call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { meta_title: "New" }, images: [{ id: "1", label: "A" }, { id: "9", label: "B" }] })).rejects.toMatchObject({ code: "not_found", argument: "images[1].id" });
    expect(puts(h.double.calls)).toEqual([]);
  });

  it("an unknown store view is invalid_argument on store_view", async () => {
    const h = harness({ [`GET ${PRODUCT_PATH}`]: json(404, { message: "Request does not match any route." }) });
    await expect(call(h, PRODUCT_CONTENT_WRITE_TOOL, { sku: SKU, store_view: VIEW, content: { name: "x" } })).rejects.toMatchObject({ code: "invalid_argument", argument: "store_view" });
  });
});
