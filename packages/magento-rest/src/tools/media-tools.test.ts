// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `media.js`. `add_product_image` uploads
// bytes that pass through the model, so it is bounded on every axis the
// original left open: size, alphabet, MIME type, and a file name that cannot
// carry a path.
import { SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { mediaTools } from "./media-tools.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(mediaTools, routes);

const RAW_ENTRY = { id: 12, media_type: "image", label: "Front", position: 1, disabled: false, types: ["image", "thumbnail"], file: "/d/e/demo.jpg", extension_attributes: { video_content: { secret: "x" } } };
const IMAGE = { sku: SKU, image_base64: "aGVsbG8=", image_name: "demo.jpg" };

describe("mediaTools surface", () => {
  it("exposes two reads and three writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual(["magentorest_get_product_media", "magentorest_get_product_media_entry"]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual(["magentorest_add_product_image", "magentorest_delete_product_media", "magentorest_update_product_media"]);
  });
});

describe("media reads", () => {
  it("get_product_media lists the entries, projected", async () => {
    const { call } = build({ [`GET /rest/V1/products/${SKU}/media`]: json(200, injectLeakProbe([RAW_ENTRY])) });
    const out = (await call("magentorest_get_product_media", { sku: SKU })) as Record<string, unknown>[];
    expect(out[0]).toEqual({ id: 12, media_type: "image", label: "Front", position: 1, disabled: false, types: ["image", "thumbnail"], file: "/d/e/demo.jpg" });
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("get_product_media returns an empty list when the response is not a list", async () => {
    const { call } = build({ [`GET /rest/V1/products/${SKU}/media`]: json(200, {}) });
    expect(await call("magentorest_get_product_media", { sku: SKU })).toEqual([]);
  });

  it("get_product_media_entry reads one entry", async () => {
    const { call } = build({ [`GET /rest/V1/products/${SKU}/media/12`]: json(200, injectLeakProbe(RAW_ENTRY)) });
    const out = (await call("magentorest_get_product_media_entry", { sku: SKU, entry_id: 12 })) as Record<string, unknown>;
    expect(out["id"]).toBe(12);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(JSON.stringify(out)).not.toContain("video_content");
  });

  it("encodes a SKU that tries to re-address the request", async () => {
    const { double, tool } = build({ "GET /rest/V1/products/a%2F..%2F..%2Fcustomers/media": json(404, { message: "no" }) });
    await expect(tool("magentorest_get_product_media").invoke({ sku: "a/../../customers" }, {})).rejects.toMatchObject({ kind: "not-found" });
    expect(double.calls.map((c) => new URL(c.url).pathname)).toEqual(["/rest/V1/products/a%2F..%2F..%2Fcustomers/media"]);
  });

  it("refuses a non-positive entry ID", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_get_product_media_entry").invoke({ sku: SKU, entry_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_add_product_image", () => {
  it("POSTs an image entry with the content, defaulting type, position, flags and label", async () => {
    const { double, call } = build({ [`POST /rest/V1/products/${SKU}/media`]: json(200, 12) });
    expect(await call("magentorest_add_product_image", IMAGE)).toBe(12);
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({
      entry: { media_type: "image", label: "demo.jpg", position: 0, disabled: false, types: [], content: { base64_encoded_data: "aGVsbG8=", type: "image/jpeg", name: "demo.jpg" } },
    });
  });

  it("honours label, position, roles, MIME type and the disabled flag", async () => {
    const { double, call } = build({ [`POST /rest/V1/products/${SKU}/media`]: json(200, 12) });
    await call("magentorest_add_product_image", { ...IMAGE, image_name: "demo.png", image_type: "image/png", label: "Front", position: 2, types: ["image", "small_image"], disabled: true });
    const entry = (JSON.parse(double.calls[0]?.body ?? "{}") as { entry: Record<string, unknown> }).entry;
    expect(entry).toMatchObject({ label: "Front", position: 2, disabled: true, types: ["image", "small_image"] });
    expect(entry["content"]).toMatchObject({ type: "image/png", name: "demo.png" });
  });

  it.each([
    ["a file name carrying a path", { image_name: "../../evil.jpg" }],
    ["a file name with a slash", { image_name: "a/b.jpg" }],
    ["a file name that is not an image extension", { image_name: "shell.php" }],
    ["a file name with no extension", { image_name: "demo" }],
    ["a MIME type outside the allowed images", { image_type: "text/html" }],
    ["data that is not base64", { image_base64: "not base64 !!" }],
    ["empty data", { image_base64: "" }],
    ["data above 2,000,000 characters", { image_base64: "A".repeat(2_000_001) }],
    ["an unknown image role", { types: ["admin_only"] }],
    ["a negative position", { position: -1 }],
    ["an unknown argument", { extra: 1 }],
  ])("refuses %s before any request", async (_name, bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_add_product_image").invoke({ ...IMAGE, ...bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("never echoes the image data in an error", async () => {
    const { tool } = build({ [`POST /rest/V1/products/${SKU}/media`]: json(400, { message: "Invalid image" }) });
    const error = await tool("magentorest_add_product_image").invoke({ ...IMAGE, image_base64: "QUJDREVGRw==" }, {}).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("QUJDREVGRw==");
  });

  it("is sent once on a retryable failure", async () => {
    const { double, tool } = build({ [`POST /rest/V1/products/${SKU}/media`]: json(503, { message: "busy" }) });
    await expect(tool("magentorest_add_product_image").invoke(IMAGE, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });
});

describe("magentorest_update_product_media", () => {
  // Found against a live 2.4.8-p5: a PUT of `{ entry: { id, label, ... } }` is answered 400 "There is no
  // MediaGalleryEntryConverter for given type" — Magento picks the converter by `media_type`, so the body
  // must carry it. The original never sent it, so its update never worked. The entry is read first and
  // its type (and the fields not being changed) are sent back with the changes applied.
  const routes = (entry: object = RAW_ENTRY) => ({
    [`GET /rest/V1/products/${SKU}/media/12`]: json(200, entry),
    [`PUT /rest/V1/products/${SKU}/media/12`]: json(200, true),
  });

  it("reads the entry, then PUTs it back with its media_type and the changes applied", async () => {
    const { double, call } = build(routes());
    await call("magentorest_update_product_media", { sku: SKU, entry_id: 12, label: "Back", position: 3, types: ["thumbnail"], disabled: true });
    expect(double.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({
      entry: { id: 12, media_type: "image", label: "Back", position: 3, disabled: true, types: ["thumbnail"], file: "/d/e/demo.jpg" },
    });
  });

  it("keeps every field that was not changed", async () => {
    const { double, call } = build(routes());
    await call("magentorest_update_product_media", { sku: SKU, entry_id: 12, label: "Only the label" });
    expect(JSON.parse(double.calls[1]?.body ?? "{}").entry).toEqual({ id: 12, media_type: "image", label: "Only the label", position: 1, disabled: false, types: ["image", "thumbnail"], file: "/d/e/demo.jpg" });
  });

  it("keeps the entry's own media type, so a video entry is not rewritten as an image", async () => {
    const { double, call } = build(routes({ ...RAW_ENTRY, media_type: "external-video" }));
    await call("magentorest_update_product_media", { sku: SKU, entry_id: 12, label: "Clip" });
    expect(JSON.parse(double.calls[1]?.body ?? "{}").entry.media_type).toBe("external-video");
  });

  it("lets an explicit false and an explicit empty role list through, rather than keeping the old value", async () => {
    const { double, call } = build(routes({ ...RAW_ENTRY, disabled: true }));
    await call("magentorest_update_product_media", { sku: SKU, entry_id: 12, disabled: false, types: [] });
    const entry = JSON.parse(double.calls[1]?.body ?? "{}").entry;
    expect(entry.disabled).toBe(false);
    expect(entry.types).toEqual([]);
  });

  it("refuses an update that changes nothing, without calling Magento", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_product_media").invoke({ sku: SKU, entry_id: 12 }, {})).rejects.toThrow(/nothing to update/i);
    expect(double.calls).toHaveLength(0);
  });

  it("is an idempotent destructive update", () => {
    expect(build({}).tool("magentorest_update_product_media").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });
});

describe("magentorest_delete_product_media", () => {
  it("DELETEs the entry and returns Magento's boolean", async () => {
    const { double, call, tool } = build({ [`DELETE /rest/V1/products/${SKU}/media/12`]: json(200, true) });
    expect(await call("magentorest_delete_product_media", { sku: SKU, entry_id: 12 })).toBe(true);
    expect(double.calls[0]?.method).toBe("DELETE");
    expect(tool("magentorest_delete_product_media").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});
