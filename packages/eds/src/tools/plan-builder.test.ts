// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 4.1 requests, 4.2–4.7): what
// `eds_plan` reads, records, shows and warns about. The recorded requests are
// read back from the plan store — `eds_apply` replays exactly those.
import { describe, expect, it } from "vitest";
import { createPlanStore, type PlanStore } from "../confirm/plan-store.js";
import { fingerprint } from "../confirm/fingerprint.js";
import { callKeys, createClientDouble, TEST_ORG } from "../testing/client-double.js";
import type { RouteTable } from "../testing/fetch-double.js";
import { buildPlan, PLAN_INSTRUCTION, type PlanResult, type StoredPlan } from "./plan-builder.js";
import type { EdsPlanInput } from "./plan.js";

const EU = "acme-demo-site-eu";
const US = "acme-demo-site-us";
const EU_DOC = `/config/${TEST_ORG}/sites/${EU}.json`;
const US_DOC = `/config/${TEST_ORG}/sites/${US}.json`;
const EU_VERSIONS = `/config/${TEST_ORG}/sites/${EU}/versions.json`;
const EU_ROBOTS = `/config/${TEST_ORG}/sites/${EU}/robots.txt`;

const SITE_DOC = {
  version: 1,
  code: { owner: "example-owner", repo: "example-repo" },
  content: { source: { type: "markup", url: "https://demo-host.example-domain/content" } },
  a: 1,
  b: { c: 2 },
};
const AEM_DOC = {
  ...SITE_DOC,
  content: { source: { type: "markup", url: "https://demo-host.example-domain/bin/franklin.delivery/example-owner/example-repo/main" } },
};

function baseRoutes(doc: unknown = SITE_DOC): Record<string, unknown> {
  return {
    [`GET ${EU_DOC}`]: { status: 200, body: doc },
    [`GET ${EU_VERSIONS}`]: { status: 200, body: { current: 7, versions: [{ version: 7, created: "2026-10-01T00:00:00Z" }] } },
    [`GET ${EU_ROBOTS}`]: { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /" },
    [`GET ${US_DOC}`]: { status: 404 },
  };
}

interface Harness {
  readonly store: PlanStore<StoredPlan>;
  readonly calls: ReturnType<typeof createClientDouble>["calls"];
  plan(input: EdsPlanInput): Promise<PlanResult>;
  stored(result: PlanResult): StoredPlan;
}

function harness(options: { routes?: Record<string, unknown>; protectedSites?: readonly string[] } = {}): Harness {
  const { client, calls } = createClientDouble((options.routes ?? baseRoutes()) as RouteTable);
  const store = createPlanStore<StoredPlan>({ now: () => 0 });
  const deps = { client, org: TEST_ORG, store, protectedSites: options.protectedSites ?? [] };
  return {
    store,
    calls,
    plan: (input) => buildPlan(deps, input),
    stored(result) {
      if (result.status !== "planned") throw new Error(`expected a planned result, got ${result.status}`);
      const lookup = store.peek(result.token);
      if (lookup.status !== "ok") throw new Error(`token not in store: ${lookup.reason}`);
      return lookup.plan;
    },
  };
}

async function recorded(input: EdsPlanInput, routes?: Record<string, unknown>) {
  const h = harness(routes === undefined ? {} : { routes });
  return h.stored(await h.plan(input)).requests;
}

/** One valid plan input per kind, all against `acme-demo-site-eu` unless they need another. */
const EVERY_KIND: readonly EdsPlanInput[] = [
  { site: EU, operation: { kind: "config.patch", patch: { a: 2 } } },
  { site: US, operation: { kind: "site.create", config: { code: { owner: "example-owner", repo: "example-repo" } } } },
  { site: EU, operation: { kind: "site.delete" } },
  { site: EU, operation: { kind: "version.restore", versionId: "3" } },
  { site: EU, operation: { kind: "robots.set", content: "User-agent: *\nDisallow: /" } },
  { site: EU, operation: { kind: "preview.update", paths: ["/a", "/b"] } },
  { site: EU, operation: { kind: "preview.delete", paths: ["/a"] } },
  { site: EU, operation: { kind: "live.publish", paths: ["/a", "/b"] } },
  { site: EU, operation: { kind: "live.unpublish", paths: ["/a"] } },
  { site: EU, operation: { kind: "index.update", paths: ["/a", "/b"] } },
  { site: EU, operation: { kind: "index.delete", paths: ["/a", "/b"] } },
  { site: EU, operation: { kind: "index.full-site", confirmFullReindex: true } },
  { site: EU, operation: { kind: "cache.purge", paths: ["/a", "/b"] } },
  { site: EU, operation: { kind: "sitemap.rebuild", path: "/sitemap.xml" } },
  { site: EU, operation: { kind: "code.sync", paths: ["/scripts/a.js"] } },
  { site: EU, operation: { kind: "code.delete", paths: ["/scripts/a.js"] } },
  { site: EU, operation: { kind: "job.stop", topic: "live", name: "job-demo" } },
  { site: EU, operation: { kind: "snapshot.add", id: "launch-demo", paths: ["/a"] } },
  { site: EU, operation: { kind: "snapshot.remove", id: "launch-demo", paths: ["/a"] } },
  { site: EU, operation: { kind: "snapshot.publish", id: "launch-demo" } },
  { site: EU, operation: { kind: "snapshot.review", id: "launch-demo", reviewAction: "approve" } },
  { site: EU, operation: { kind: "snapshot.delete", id: "launch-demo" } },
];

describe("buildPlan — recorded requests per kind (4.1)", () => {
  it("covers all 22 kinds", () => {
    expect(new Set(EVERY_KIND.map((input) => input.operation.kind)).size).toBe(22);
  });

  it("config.patch records a POST of the full merged document", async () => {
    expect(await recorded({ site: EU, operation: { kind: "config.patch", patch: { b: { c: 3 }, d: true } } })).toEqual([
      { method: "POST", path: EU_DOC, body: { ...SITE_DOC, b: { c: 3 }, d: true } },
    ]);
  });

  it("site.create records a PUT of the config, planned while the site is absent", async () => {
    const config = { code: { owner: "example-owner", repo: "example-repo" } };
    expect(await recorded({ site: US, operation: { kind: "site.create", config } })).toEqual([{ method: "PUT", path: US_DOC, body: config }]);
  });

  it("site.create refuses an existing site, issuing no token", async () => {
    const h = harness();
    await expect(h.plan({ site: EU, operation: { kind: "site.create", config: {} } })).rejects.toThrow(/acme-demo-site-eu.*already exists/);
  });

  it("site.delete records a bodyless DELETE", async () => {
    expect(await recorded({ site: EU, operation: { kind: "site.delete" } })).toEqual([{ method: "DELETE", path: EU_DOC }]);
  });

  it("version.restore records a bodyless POST with the encoded id", async () => {
    expect(await recorded({ site: EU, operation: { kind: "version.restore", versionId: "3" } })).toEqual([
      { method: "POST", path: `${EU_DOC}?restoreVersion=3` },
    ]);
  });

  it("robots.set records a text POST", async () => {
    expect(await recorded({ site: EU, operation: { kind: "robots.set", content: "User-agent: *\nDisallow: /" } })).toEqual([
      { method: "POST", path: EU_ROBOTS, text: "User-agent: *\nDisallow: /" },
    ]);
  });

  it.each([
    ["preview.update", "POST", "preview"],
    ["preview.delete", "DELETE", "preview"],
    ["live.publish", "POST", "live"],
    ["live.unpublish", "DELETE", "live"],
    ["index.update", "POST", "index"],
    ["index.delete", "DELETE", "index"],
  ] as const)("%s on one path records a single bodyless %s", async (kind, method, resource) => {
    expect(await recorded({ site: EU, operation: { kind, paths: ["/products/demo"] } })).toEqual([
      { method, path: `/${resource}/${TEST_ORG}/${EU}/main/products/demo` },
    ]);
  });

  it.each([
    ["preview.update", "preview", { paths: ["/a", "/b"] }],
    ["preview.delete", "preview", { paths: ["/a", "/b"], delete: true }],
    ["live.publish", "live", { paths: ["/a", "/b"] }],
    ["live.unpublish", "live", { paths: ["/a", "/b"], delete: true }],
    ["index.update", "index", { paths: ["/a", "/b"] }],
  ] as const)("%s on several paths records one bulk POST with %j", async (kind, resource, body) => {
    expect(await recorded({ site: EU, operation: { kind, paths: ["/a", "/b"] } })).toEqual([
      { method: "POST", path: `/${resource}/${TEST_ORG}/${EU}/main/*`, body },
    ]);
  });

  it("index.delete on several paths records one DELETE per path (the contract has no bulk index delete)", async () => {
    expect(await recorded({ site: EU, operation: { kind: "index.delete", paths: ["/a", "/b"] } })).toEqual([
      { method: "DELETE", path: `/index/${TEST_ORG}/${EU}/main/a` },
      { method: "DELETE", path: `/index/${TEST_ORG}/${EU}/main/b` },
    ]);
  });

  it("index.full-site records the bodyless POST and warns", async () => {
    const h = harness();
    const result = await h.plan({ site: EU, operation: { kind: "index.full-site", confirmFullReindex: true } });

    expect(h.stored(result).requests).toEqual([{ method: "POST", path: `/index/${TEST_ORG}/${EU}/main/*` }]);
    expect(result.status === "planned" && result.warnings.some((w) => /full-site reindex/i.test(w))).toBe(true);
  });

  it("cache.purge records one POST per path; sitemap.rebuild one POST", async () => {
    expect(await recorded({ site: EU, operation: { kind: "cache.purge", paths: ["/a", "/b"] } })).toEqual([
      { method: "POST", path: `/cache/${TEST_ORG}/${EU}/main/a` },
      { method: "POST", path: `/cache/${TEST_ORG}/${EU}/main/b` },
    ]);
    expect(await recorded({ site: EU, operation: { kind: "sitemap.rebuild", path: "/sitemap.xml" } })).toEqual([
      { method: "POST", path: `/sitemap/${TEST_ORG}/${EU}/main/sitemap.xml` },
    ]);
  });

  it("code.sync / code.delete resolve owner/repo from the site document (4.6)", async () => {
    expect(await recorded({ site: EU, operation: { kind: "code.sync", paths: ["/scripts/a.js"] } })).toEqual([
      { method: "POST", path: "/code/example-owner/example-repo/main/scripts/a.js" },
    ]);
    expect(await recorded({ site: EU, operation: { kind: "code.delete", paths: ["/scripts/a.js"] } })).toEqual([
      { method: "DELETE", path: "/code/example-owner/example-repo/main/scripts/a.js" },
    ]);
  });

  it("code.* refuses a site whose document names no repository", async () => {
    const h = harness({ routes: baseRoutes({ a: 1 }) });
    await expect(h.plan({ site: EU, operation: { kind: "code.sync", paths: ["/a.js"] } })).rejects.toThrow(/code\.owner.*code\.repo/);
  });

  it("job.stop records a DELETE of the job", async () => {
    expect(await recorded({ site: EU, operation: { kind: "job.stop", topic: "live", name: "job-demo" } })).toEqual([
      { method: "DELETE", path: `/job/${TEST_ORG}/${EU}/main/live/job-demo` },
    ]);
  });

  it("snapshot kinds record the snapshot client's requests", async () => {
    const base = `/snapshot/${TEST_ORG}/${EU}/main/launch-demo`;
    expect(await recorded({ site: EU, operation: { kind: "snapshot.add", id: "launch-demo" } })).toEqual([{ method: "POST", path: base, body: { paths: [] } }]);
    expect(await recorded({ site: EU, operation: { kind: "snapshot.remove", id: "launch-demo", paths: ["/a"] } })).toEqual([
      { method: "POST", path: `${base}/remove`, body: { paths: ["/a"] } },
    ]);
    expect(await recorded({ site: EU, operation: { kind: "snapshot.publish", id: "launch-demo" } })).toEqual([{ method: "POST", path: `${base}/publish`, body: {} }]);
    expect(await recorded({ site: EU, operation: { kind: "snapshot.review", id: "launch-demo", reviewAction: "reject", message: "no" } })).toEqual([
      { method: "POST", path: `${base}/review`, body: { reviewAction: "reject", message: "no" } },
    ]);
    expect(await recorded({ site: EU, operation: { kind: "snapshot.delete", id: "launch-demo" } })).toEqual([{ method: "DELETE", path: base, body: {} }]);
  });

  it("ref replaces main on ref-scoped kinds", async () => {
    expect(await recorded({ site: EU, ref: "feature-demo", operation: { kind: "live.publish", paths: ["/a"] } })).toEqual([
      { method: "POST", path: `/live/${TEST_ORG}/${EU}/feature-demo/a` },
    ]);
  });

  it.each(["config.patch", "site.delete", "snapshot.publish"] as const)("ref is refused on %s, which has no ref", async (kind) => {
    const operation = kind === "config.patch" ? { kind, patch: { a: 2 } } : kind === "snapshot.publish" ? { kind, id: "launch-demo" } : { kind };
    await expect(harness().plan({ site: EU, ref: "feature-demo", operation } as EdsPlanInput)).rejects.toThrow(/ref/);
  });
});

describe("buildPlan — planning only reads (4.2)", () => {
  it.each(EVERY_KIND.map((input) => [input.operation.kind, input] as const))("%s issues only GETs", async (_kind, input) => {
    const h = harness();
    await h.plan(input);
    expect(h.calls.every((call) => call.method === "GET"), callKeys(h.calls).join(", ")).toBe(true);
  });
});

describe("buildPlan — config plans (4.3)", () => {
  it("returns every changed key, the fingerprint of the reviewed document and the current version", async () => {
    const h = harness();
    const result = await h.plan({ site: EU, operation: { kind: "config.patch", patch: { b: { c: 3 }, d: true } } });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.changes).toEqual([
      { pointer: "/b/c", before: 2, after: 3 },
      { pointer: "/d", after: true },
    ]);
    expect(h.stored(result).fingerprint).toEqual({ read: "site-document", sha256: fingerprint(SITE_DOC) });
    expect(h.stored(result).previousVersionId).toBe("7");
  });

  it("an empty diff is no-changes and issues no token", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "config.patch", patch: { a: 1 } } });

    expect(result).toEqual({ status: "no-changes", site: EU, summary: expect.any(String) });
    expect(result).not.toHaveProperty("token");
  });

  it("robots.set with the current content is no-changes", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "robots.set", content: "User-agent: *\nAllow: /" } });
    expect(result.status).toBe("no-changes");
  });

  it.each([
    [{ kind: "site.delete" }, "site-document"],
    [{ kind: "version.restore", versionId: "3" }, "site-document"],
    [{ kind: "robots.set", content: "x" }, "robots"],
  ] as const)("%j is fingerprinted by %s", async (operation, read) => {
    const h = harness();
    const stored = h.stored(await h.plan({ site: EU, operation } as EdsPlanInput));
    expect(stored.fingerprint?.read).toBe(read);
  });

  it("site.create is fingerprinted by absence", async () => {
    const h = harness();
    const stored = h.stored(await h.plan({ site: US, operation: { kind: "site.create", config: {} } }));
    expect(stored.fingerprint).toEqual({ read: "site-absent" });
  });

  it("content kinds are not fingerprinted", async () => {
    const h = harness();
    const stored = h.stored(await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } }));
    expect(stored.fingerprint).toBeUndefined();
  });
});

describe("buildPlan — every planned result is complete (4.4)", () => {
  it.each(EVERY_KIND.map((input) => [input.operation.kind, input] as const))("%s", async (kind, input) => {
    const result = await harness().plan(input);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt);
    expect(result.site).toBe(input.site);
    expect(result.kind).toBe(kind);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).not.toContain("\n");
    expect(result.requests.length).toBeGreaterThan(0);
    expect(result.requests.every((request) => typeof request.method === "string" && request.path.startsWith("/"))).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.instruction).toBe(PLAN_INSTRUCTION);
    expect(result.confirmationMessage).toContain(input.site);
    expect(result.requiresConfirmSite).toBe(false);
    for (const warning of result.warnings) expect(result.confirmationMessage).toContain(warning);
    for (const request of result.requests) expect(result.confirmationMessage).toContain(`${request.method} ${request.path}`);
  });

  it("the instruction forbids applying without an explicit confirmation", () => {
    expect(PLAN_INSTRUCTION).toMatch(/confirmationMessage/);
    expect(PLAN_INSTRUCTION).toMatch(/eds_apply only if/);
    expect(PLAN_INSTRUCTION).toMatch(/eds_plan again/);
  });

  it("the message lists each change with before and after", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "config.patch", patch: { b: { c: 3 }, d: true } } });
    const message = result.status === "planned" ? result.confirmationMessage : "";

    expect(message).toMatch(/\/b\/c: 2 → 3/);
    expect(message).toMatch(/\/d: \(absent\) → true/);
  });

  it("robots.set shows the current and the new content", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "robots.set", content: "User-agent: *\nDisallow: /" } });
    const message = result.status === "planned" ? result.confirmationMessage : "";

    expect(message).toContain("Allow: /");
    expect(message).toContain("Disallow: /");
  });

  it.each([
    ["site.delete", { kind: "site.delete" }],
    ["live.unpublish", { kind: "live.unpublish", paths: ["/a"] }],
    ["preview.delete", { kind: "preview.delete", paths: ["/a"] }],
    ["code.delete", { kind: "code.delete", paths: ["/a.js"] }],
    ["snapshot.delete", { kind: "snapshot.delete", id: "launch-demo" }],
  ] as const)("%s carries a removal warning", async (_kind, operation) => {
    const result = await harness().plan({ site: EU, operation } as EdsPlanInput);
    expect(result.status === "planned" && result.warnings.some((w) => /remove|delete/i.test(w))).toBe(true);
  });
});

describe("buildPlan — protected sites (4.11, plan half)", () => {
  it("a matching site requires confirmSite, warns and asks for the site name", async () => {
    const h = harness({ protectedSites: ["*-eu"] });
    const result = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });

    expect(result.status === "planned" && result.requiresConfirmSite).toBe(true);
    expect(result.status === "planned" && result.warnings.some((w) => w.includes("protected"))).toBe(true);
    expect(result.status === "planned" && result.confirmationMessage).toContain(`reply with the site name "${EU}"`);
    expect(h.stored(result).protected).toBe(true);
  });

  it("pattern characters other than * are literal", async () => {
    const h = harness({ protectedSites: ["acme.demo-site-eu"] });
    const result = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });
    expect(result.status === "planned" && result.requiresConfirmSite).toBe(false);
  });
});

describe("buildPlan — AEM content source warning (4.5)", () => {
  const AEM = /replication record in AEM/;

  it.each(["preview.update", "preview.delete", "live.publish", "live.unpublish"] as const)("%s on an AEM-sourced site warns", async (kind) => {
    const result = await harness({ routes: baseRoutes(AEM_DOC) }).plan({ site: EU, operation: { kind, paths: ["/a"] } });
    expect(result.status === "planned" && result.warnings.some((w) => AEM.test(w))).toBe(true);
  });

  it("a markup source with another URL does not warn", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });
    expect(result.status === "planned" && result.warnings.some((w) => AEM.test(w))).toBe(false);
  });

  it("a non-markup source whose URL happens to contain the AEM path does not warn", async () => {
    const doc = { ...SITE_DOC, content: { source: { type: "onedrive", url: "https://demo-host.example-domain/bin/franklin.delivery/x" } } };
    const result = await harness({ routes: baseRoutes(doc) }).plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });
    expect(result.status === "planned" && result.warnings.some((w) => AEM.test(w))).toBe(false);
  });

  it("other kinds on an AEM-sourced site do not warn", async () => {
    const result = await harness({ routes: baseRoutes(AEM_DOC) }).plan({ site: EU, operation: { kind: "index.update", paths: ["/a"] } });
    expect(result.status === "planned" && result.warnings.some((w) => AEM.test(w))).toBe(false);
  });
});

describe("buildPlan — secrets round-trip warning (4.5b)", () => {
  it.each(["secrets", "tokens"])("a non-empty %s key in the document is named in a warning", async (key) => {
    const doc = { ...SITE_DOC, [key]: { "demo-entry": { id: "demo-id" } } };
    const result = await harness({ routes: baseRoutes(doc) }).plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });
    expect(result.status === "planned" && result.warnings.some((w) => w.includes(`"${key}"`))).toBe(true);
  });

  it("an empty secrets object does not warn", async () => {
    const doc = { ...SITE_DOC, secrets: {} };
    const result = await harness({ routes: baseRoutes(doc) }).plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });
    expect(result.status === "planned" && result.warnings.some((w) => w.includes('"secrets"'))).toBe(false);
  });
});

describe("buildPlan — code repository in the message (4.6)", () => {
  it("names owner/repo", async () => {
    const result = await harness().plan({ site: EU, operation: { kind: "code.sync", paths: ["/scripts/a.js"] } });
    expect(result.status === "planned" && result.confirmationMessage).toContain("example-owner/example-repo");
  });
});

describe("buildPlan — redaction (4.7)", () => {
  it("a secret-shaped value in the site document never appears in the plan output", async () => {
    const doc = {
      ...SITE_DOC,
      tokens: { demo: { value: "tok-demo-value-0000000001" } },
      headers: { "/**": [{ key: "x-demo", value: "authorization: token abc-demo-0000000002" }] },
      apiKey: "key-demo-0000000003",
    };
    const patch = { tokens: { demo: { value: "tok-demo-value-0000000004" } }, headers: null, apiKey: "key-demo-0000000005", a: 2 };
    const result = await harness({ routes: baseRoutes(doc) }).plan({ site: EU, operation: { kind: "config.patch", patch } });
    const output = JSON.stringify(result);

    for (let i = 1; i <= 5; i += 1) expect(output).not.toContain(`000000000${i}`);
    expect(output).toContain("/a");
  });
});
