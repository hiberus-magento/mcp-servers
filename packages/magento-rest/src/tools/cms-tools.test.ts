// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `cms.js`. CMS writes put HTML into a
// live storefront, so the cases that matter most are the bounds (identifier
// shape, content length, store ids) and the merge in `update_*` — which reads
// the record first, as the original did, but treats an explicit empty
// identifier or title as an error rather than silently keeping the old one.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { cmsTools } from "./cms-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(cmsTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const KINDS = [
  { kind: "block", path: "cmsBlock", idKey: "block_id", wrapper: "block", raw: { id: 5, identifier: "demo-banner", title: "Demo Banner", content: "<p>Hello</p>", creation_time: "2026-01-01 00:00:00", update_time: "2026-01-02 00:00:00", active: true, hidden: "x" } },
  { kind: "page", path: "cmsPage", idKey: "page_id", wrapper: "page", raw: { id: 5, identifier: "demo-page", title: "Demo Page", page_layout: "1column", content: "<p>Hello</p>", content_heading: "H", meta_title: "M", creation_time: "2026-01-01 00:00:00", update_time: "2026-01-02 00:00:00", active: true, sort_order: "0", layout_update_xml: "<update/>", hidden: "x" } },
] as const;

describe("cmsTools surface", () => {
  it("exposes four reads and six writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_cms_block_by_id",
      "magentorest_get_cms_page_by_id",
      "magentorest_search_cms_blocks",
      "magentorest_search_cms_pages",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual([
      "magentorest_create_cms_block",
      "magentorest_create_cms_page",
      "magentorest_delete_cms_block",
      "magentorest_delete_cms_page",
      "magentorest_update_cms_block",
      "magentorest_update_cms_page",
    ]);
  });
});

describe.each(KINDS)("CMS $kind", ({ kind, path, idKey, wrapper, raw }) => {
  const get = `magentorest_get_cms_${kind}_by_id`;
  const search = `magentorest_search_cms_${kind}s`;
  const create = `magentorest_create_cms_${kind}`;
  const update = `magentorest_update_cms_${kind}`;
  const remove = `magentorest_delete_cms_${kind}`;
  const base = { identifier: `demo-${kind}`, title: "Demo", content: "<p>x</p>" };

  it(`${get} returns the content, projected, without layout XML or undeclared fields`, async () => {
    const { call } = build({ [`GET /rest/V1/${path}/5`]: json(200, injectLeakProbe(raw)) });
    const out = (await call(get, { [idKey]: 5 })) as Record<string, unknown>;
    expect(out["content"]).toBe("<p>Hello</p>");
    const text = JSON.stringify(out);
    for (const hidden of ["<update/>", '"hidden"', LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it(`${get} refuses a non-positive ID before any request`, async () => {
    const { double, tool } = build({});
    await expect(tool(get).invoke({ [idKey]: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it(`${search} puts each filter in its own group (AND) and bounds the page`, async () => {
    const { double, call } = build({ [`GET /rest/V1/${path}/search`]: json(200, { items: [], total_count: 0 }) });
    await call(search, { identifier: "demo", title: "ban", is_active: true });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["identifier", "demo", "eq"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["title", "%ban%", "like"]);
    expect([f(2, "field"), f(2, "value")]).toEqual(["is_active", "1"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("20");
  });

  it(`${search} returns summaries WITHOUT the content`, async () => {
    const { call } = build({ [`GET /rest/V1/${path}/search`]: json(200, injectLeakProbe({ items: [raw], total_count: 1 })) });
    const out = (await call(search, {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(out.items[0]).not.toHaveProperty("content");
    expect(out.items[0]?.["identifier"]).toBe(raw.identifier);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each(["a b", "x&y", "../etc", "", "x".repeat(101)])(`${search} refuses the identifier %j`, async (bad) => {
    const { double, tool } = build({});
    await expect(tool(search).invoke({ identifier: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it(`${search} refuses a page size above 100`, async () => {
    const { tool } = build({});
    await expect(tool(search).invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });

  // Found against a live 2.4.8-p5: a body carrying `store_id` is answered 400 ("%fieldName" is not supported,
  // fieldName StoreId) — the REST body for a block or page takes no store assignment, so the original's
  // create never worked here. Without it Magento creates the record for all store views.
  it(`${create} wraps the ${wrapper}, defaults active, and sends NO store_id — Magento refuses that field`, async () => {
    const { double, call } = build({ [`POST /rest/V1/${path}`]: json(200, injectLeakProbe(raw)) });
    const out = await call(create, base);
    const body = JSON.parse(double.calls[0]?.body ?? "{}") as Record<string, Record<string, unknown>>;
    expect(body[wrapper]).toMatchObject({ identifier: `demo-${kind}`, title: "Demo", content: "<p>x</p>", active: true });
    expect(body[wrapper]).not.toHaveProperty("store_id");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each([
    ["an identifier with a space", { identifier: "a b" }],
    ["an empty title", { title: "" }],
    ["an over-long title", { title: "x".repeat(256) }],
    ["content beyond 200,000 characters", { content: "x".repeat(200_001) }],
    ["a store_ids argument, which the REST body cannot carry", { store_ids: [0] }],
    ["an unknown argument", { extra: 1 }],
  ])(`${create} refuses %s before any request`, async (_name, bad) => {
    const { double, tool } = build({});
    await expect(tool(create).invoke({ ...base, ...bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it(`${update} reads the record, then PUTs the merge, keeping what was not changed`, async () => {
    const { double, call } = build({ [`GET /rest/V1/${path}/5`]: json(200, raw), [`PUT /rest/V1/${path}/5`]: json(200, raw) });
    await call(update, { [idKey]: 5, title: "Renamed" });
    expect(double.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ [wrapper]: { id: 5, identifier: raw.identifier, title: "Renamed", content: "<p>Hello</p>", active: true } });
  });

  it(`${update} lets an explicit empty content clear it, and a false flag deactivate`, async () => {
    const { double, call } = build({ [`GET /rest/V1/${path}/5`]: json(200, raw), [`PUT /rest/V1/${path}/5`]: json(200, raw) });
    await call(update, { [idKey]: 5, content: "", is_active: false });
    expect(JSON.parse(double.calls[1]?.body ?? "{}")[wrapper]).toMatchObject({ content: "", active: false });
  });

  it(`${update} refuses an empty identifier or title, which the original read as 'keep the old one'`, async () => {
    const { double, tool } = build({});
    await expect(tool(update).invoke({ [idKey]: 5, identifier: "" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool(update).invoke({ [idKey]: 5, title: "" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it(`${update} refuses an update that changes nothing, without calling Magento`, async () => {
    const { double, tool } = build({});
    await expect(tool(update).invoke({ [idKey]: 5 }, {})).rejects.toThrow(/nothing to update/i);
    expect(double.calls).toHaveLength(0);
  });

  it(`${remove} returns Magento's boolean and is destructive`, async () => {
    const { double, call, tool } = build({ [`DELETE /rest/V1/${path}/5`]: json(200, true) });
    expect(await call(remove, { [idKey]: 5 })).toBe(true);
    expect(double.calls[0]?.method).toBe("DELETE");
    expect(tool(remove).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it(`${create} is sent once even when Magento answers 503`, async () => {
    const { double, tool } = build({ [`POST /rest/V1/${path}`]: json(503, { message: "busy" }) });
    await expect(tool(create).invoke(base, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });
});

describe("CMS page extras", () => {
  const base = { identifier: "demo-page", title: "Demo", content: "<p>x</p>" };

  it("defaults the layout to 1column and sends the optional SEO fields only when given", async () => {
    const { double, call } = build({ "POST /rest/V1/cmsPage": json(200, {}) });
    await call("magentorest_create_cms_page", base);
    await call("magentorest_create_cms_page", { ...base, content_heading: "H", meta_title: "T", meta_keywords: "k", meta_description: "D", page_layout: "2columns-left" });
    const first = (JSON.parse(double.calls[0]?.body ?? "{}") as { page: Record<string, unknown> }).page;
    expect(first["page_layout"]).toBe("1column");
    for (const key of ["content_heading", "meta_title", "meta_keywords", "meta_description"]) {
      expect(first, key).not.toHaveProperty(key);
    }
    expect((JSON.parse(double.calls[1]?.body ?? "{}") as { page: Record<string, unknown> }).page).toMatchObject({ content_heading: "H", meta_title: "T", meta_keywords: "k", meta_description: "D", page_layout: "2columns-left" });
  });

  it("refuses a layout outside the five Magento ships", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_create_cms_page").invoke({ ...base, page_layout: "full-bleed" }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("a block takes no layout or SEO field", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_create_cms_block").invoke({ identifier: "b", title: "T", content: "c", page_layout: "1column" }, {})).rejects.toBeInstanceOf(ZodError);
  });
});
