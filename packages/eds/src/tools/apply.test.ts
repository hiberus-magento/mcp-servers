// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 4.8–4.14; eds-mcp spec, "Tokens Are
// Single-Use, Expiring and Unforgeable", "Stale Configuration Plans Are
// Rejected", "Protected Sites Require the Site Name", "Apply Result
// Reserves a Pending Status"). The write gate is asserted on the wire: the
// fetch double records every request, and a rejected apply must leave no
// write in it.
import { describe, expect, it } from "vitest";
import { createPlanStore, PLAN_TTL_MS } from "../confirm/plan-store.js";
import { callKeys, createClientDouble, TEST_ORG } from "../testing/client-double.js";
import type { RecordedCall, RouteResponse, RouteTable } from "../testing/fetch-double.js";
import { applyPlan, type ApplyResult } from "./apply.js";
import { buildPlan, type StoredPlan } from "./plan-builder.js";
import type { EdsPlanInput } from "./plan.js";

const EU = "acme-demo-site-eu";
const US = "acme-demo-site-us";
const EU_DOC = `/config/${TEST_ORG}/sites/${EU}.json`;
const US_DOC = `/config/${TEST_ORG}/sites/${US}.json`;
const SITE_DOC = { code: { owner: "example-owner", repo: "example-repo" }, a: 1 };
const JOB_SELF = `https://admin.hlx.page/job/${TEST_ORG}/${EU}/main/live/job-demo`;
const JOB_BODY = { job: { name: "job-demo", topic: "live", state: "created" }, links: { self: JOB_SELF } };

type Reads = Record<string, RouteResponse | readonly RouteResponse[]>;

function defaultReads(): Reads {
  return {
    [`GET ${EU_DOC}`]: { status: 200, body: SITE_DOC },
    [`GET /config/${TEST_ORG}/sites/${EU}/versions.json`]: { status: 200, body: { current: 7, versions: [] } },
    [`GET /config/${TEST_ORG}/sites/${EU}/robots.txt`]: { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *" },
    [`GET ${US_DOC}`]: { status: 404 },
    [`GET /job/${TEST_ORG}/${EU}/main/live/job-demo`]: [
      { status: 200, body: { job: { name: "job-demo", topic: "live", state: "running" }, links: { self: JOB_SELF } } },
      { status: 200, body: { job: { name: "job-demo", topic: "live", state: "completed", progress: { total: 2, processed: 2 } }, links: { self: JOB_SELF } } },
    ],
  };
}

/** Reads come from `reads`; every write is answered with a job body. */
function routes(reads: Reads): RouteTable {
  const write = () => ({ status: 200, body: JOB_BODY });
  return new Proxy({} as RouteTable, {
    get: (_target, key: string) => reads[key] ?? (key.startsWith("GET ") ? undefined : write),
  });
}

function harness(options: { reads?: Reads; protectedSites?: readonly string[] } = {}) {
  let now = 1_000_000;
  const { client, calls } = createClientDouble(routes(options.reads ?? defaultReads()));
  const store = createPlanStore<StoredPlan>({ now: () => now });
  const deps = { client, org: TEST_ORG, store, protectedSites: options.protectedSites ?? [] };
  return {
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    async plan(input: EdsPlanInput): Promise<{ token: string; stored: StoredPlan }> {
      const result = await buildPlan(deps, input);
      if (result.status !== "planned") throw new Error("expected a planned result");
      const lookup = store.peek(result.token);
      if (lookup.status !== "ok") throw new Error("token not stored");
      return { token: result.token, stored: lookup.plan };
    },
    apply: (input: { token: string; confirmSite?: string; wait?: boolean }) => applyPlan({ client, store }, input),
  };
}

function writes(calls: readonly RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method !== "GET");
}

function rejected(result: ApplyResult, reason: string) {
  expect(result.status).toBe("rejected");
  expect(result.status === "rejected" && result.reason).toBe(reason);
  expect(result.status === "rejected" && result.message.length).toBeGreaterThan(0);
}

const EVERY_KIND: readonly EdsPlanInput[] = [
  { site: EU, operation: { kind: "config.patch", patch: { a: 2 } } },
  { site: US, operation: { kind: "site.create", config: { a: 1 } } },
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
const KINDS = EVERY_KIND.map((input) => [input.operation.kind, input] as const);

describe("eds_apply — the write gate, for every kind (4.8)", () => {
  it.each(KINDS)("%s: a forged token issues no write", async (_kind, input) => {
    const h = harness();
    await h.plan(input);

    rejected(await h.apply({ token: "forged-token-0000000000000000000000000000000" }), "unknown-token");
    expect(writes(h.calls)).toEqual([]);
  });

  it.each(KINDS)("%s: an expired token issues no write", async (_kind, input) => {
    const h = harness();
    const { token } = await h.plan(input);
    h.advance(PLAN_TTL_MS);

    rejected(await h.apply({ token }), "expired");
    expect(writes(h.calls)).toEqual([]);
  });

  it.each(KINDS)("%s: a reused token issues no second write", async (_kind, input) => {
    const h = harness();
    const { token } = await h.plan(input);
    await h.apply({ token });
    const afterFirst = writes(h.calls).length;

    rejected(await h.apply({ token }), "used");
    expect(writes(h.calls)).toHaveLength(afterFirst);
  });

  it("a failed apply still consumes the token: no retry re-issues the writes", async () => {
    const reads = defaultReads();
    const h = harness({ reads });
    const { token } = await h.plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });
    reads[`GET ${EU_DOC}`] = { status: 500 };

    await expect(h.apply({ token })).rejects.toThrow();
    rejected(await h.apply({ token }), "used");
    expect(writes(h.calls)).toEqual([]);
  });
});

describe("eds_apply — replay (4.9)", () => {
  it.each(KINDS)("%s issues exactly the recorded requests, byte for byte", async (_kind, input) => {
    const h = harness();
    const { token, stored } = await h.plan(input);
    const before = h.calls.length;

    const result = await h.apply({ token });

    expect(result.status).toBe("applied");
    const issued = writes(h.calls.slice(before)).map((call) => ({
      method: call.method,
      key: callKeys([call])[0]!.slice(call.method.length + 1),
      body: call.body,
      contentType: call.headers["content-type"],
    }));
    const expected = stored.requests.map((request) => ({
      method: request.method,
      key: request.path,
      body: request.text ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
      contentType: request.text !== undefined ? "text/plain" : request.body === undefined ? undefined : "application/json",
    }));
    expect(issued).toEqual(expected);
  });

  it("returns one response per request, in order", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "cache.purge", paths: ["/a", "/b"] } });

    const result = await h.apply({ token });

    expect(result.status === "applied" && result.responses).toHaveLength(2);
    expect(result.status === "applied" && result.site).toBe(EU);
    expect(result.status === "applied" && result.kind).toBe("cache.purge");
  });

  it("returns previousVersionId for a config plan", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });

    const result = await h.apply({ token });

    expect(result.status === "applied" && result.previousVersionId).toBe("7");
  });
});

describe("eds_apply — stale plans (4.10)", () => {
  it("config.patch: a document changed since the plan is stale-plan, no write", async () => {
    const reads = defaultReads();
    reads[`GET ${EU_DOC}`] = [
      { status: 200, body: SITE_DOC },
      { status: 200, body: { ...SITE_DOC, a: 5 } },
    ];
    const h = harness({ reads });
    const { token } = await h.plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });

    rejected(await h.apply({ token }), "stale-plan");
    expect(writes(h.calls)).toEqual([]);
  });

  it("config.patch: the same document with its keys reordered is NOT stale", async () => {
    const reads = defaultReads();
    reads[`GET ${EU_DOC}`] = [
      { status: 200, body: SITE_DOC },
      { status: 200, body: { a: 1, code: { repo: "example-repo", owner: "example-owner" } } },
    ];
    const h = harness({ reads });
    const { token } = await h.plan({ site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });

    expect((await h.apply({ token })).status).toBe("applied");
  });

  it("site.create: a site created since the plan is stale-plan, no PUT", async () => {
    const reads = defaultReads();
    reads[`GET ${US_DOC}`] = [{ status: 404 }, { status: 200, body: { a: 1 } }];
    const h = harness({ reads });
    const { token } = await h.plan({ site: US, operation: { kind: "site.create", config: { a: 1 } } });

    rejected(await h.apply({ token }), "stale-plan");
    expect(writes(h.calls)).toEqual([]);
  });

  it("robots.set: robots.txt changed since the plan is stale-plan", async () => {
    const reads = defaultReads();
    const robots = `GET /config/${TEST_ORG}/sites/${EU}/robots.txt`;
    reads[robots] = [
      { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *" },
      { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: demo" },
    ];
    const h = harness({ reads });
    const { token } = await h.plan({ site: EU, operation: { kind: "robots.set", content: "x" } });

    rejected(await h.apply({ token }), "stale-plan");
    expect(writes(h.calls)).toEqual([]);
  });

  it("a stale plan consumes the token: the user must plan again", async () => {
    const reads = defaultReads();
    reads[`GET ${EU_DOC}`] = [
      { status: 200, body: SITE_DOC },
      { status: 200, body: { ...SITE_DOC, a: 5 } },
    ];
    const h = harness({ reads });
    const { token } = await h.plan({ site: EU, operation: { kind: "site.delete" } });
    await h.apply({ token });

    rejected(await h.apply({ token }), "used");
  });
});

describe("eds_apply — protected sites (4.11)", () => {
  async function protectedPlan() {
    const h = harness({ protectedSites: ["*-eu"] });
    const { token } = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });
    return { h, token };
  }

  it("a missing confirmSite is rejected without consuming the token; the right one then applies", async () => {
    const { h, token } = await protectedPlan();

    rejected(await h.apply({ token }), "confirm-site-missing");
    expect(writes(h.calls)).toEqual([]);
    expect((await h.apply({ token, confirmSite: EU })).status).toBe("applied");
  });

  it("a mismatched confirmSite is rejected without consuming the token", async () => {
    const { h, token } = await protectedPlan();

    rejected(await h.apply({ token, confirmSite: US }), "confirm-site-mismatch");
    rejected(await h.apply({ token, confirmSite: EU.toUpperCase() }), "confirm-site-mismatch");
    expect(writes(h.calls)).toEqual([]);
    expect((await h.apply({ token, confirmSite: EU })).status).toBe("applied");
  });

  it("an expired protected token reports expired, not a confirmSite problem", async () => {
    const { h, token } = await protectedPlan();
    h.advance(PLAN_TTL_MS);

    rejected(await h.apply({ token }), "expired");
  });

  it("on an unprotected site, a confirmSite naming another site is still a mismatch", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });

    rejected(await h.apply({ token, confirmSite: US }), "confirm-site-mismatch");
    expect(writes(h.calls)).toEqual([]);
  });
});

describe("eds_apply — wait (4.13)", () => {
  it("wait: true on a job-backed kind returns the final job", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a", "/b"] } });

    const result = await h.apply({ token, wait: true });

    expect(result.status === "applied" && result.job).toEqual({
      name: "job-demo",
      topic: "live",
      state: "completed",
      progress: { total: 2, processed: 2 },
    });
  });

  it("without wait, a job-backed kind returns the job as submitted", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a", "/b"] } });

    const result = await h.apply({ token });

    expect(result.status === "applied" && result.job).toEqual(JOB_BODY.job);
    expect(callKeys(h.calls).some((key) => key.startsWith("GET /job/"))).toBe(false);
  });

  it("wait on a kind that is not job-backed changes nothing", async () => {
    const h = harness();
    const { token } = await h.plan({ site: EU, operation: { kind: "live.publish", paths: ["/a"] } });

    const result = await h.apply({ token, wait: true });

    expect(result.status === "applied" && result.job).toBeUndefined();
    expect(callKeys(h.calls).some((key) => key.startsWith("GET /job/"))).toBe(false);
  });
});

describe("eds_apply — pending is reserved, never produced (4.14)", () => {
  it.each(KINDS)("%s", async (_kind, input) => {
    const h = harness();
    const { token } = await h.plan(input);

    const result = await h.apply({ token, wait: true });

    expect(result.status).not.toBe("pending");
  });

  it("the type still has the pending member", () => {
    const pending: ApplyResult = { status: "pending", message: "reserved" };
    expect(pending.status).toBe("pending");
  });
});

describe("eds_apply — output redaction", () => {
  it("a secret-shaped value in a write response does not reach the result", async () => {
    const reads = defaultReads();
    const { client, calls } = createClientDouble(
      new Proxy({} as RouteTable, {
        get: (_target, key: string) =>
          (reads as Record<string, unknown>)[key] ??
          (key.startsWith("GET ") ? undefined : () => ({ status: 200, body: { ok: true, token: "tok-demo-0000000009" } })),
      }),
    );
    const store = createPlanStore<StoredPlan>({ now: () => 0 });
    const planned = await buildPlan({ client, org: TEST_ORG, store, protectedSites: [] }, { site: EU, operation: { kind: "config.patch", patch: { a: 2 } } });
    const token = planned.status === "planned" ? planned.token : "";

    const result = await applyPlan({ client, store }, { token });

    expect(JSON.stringify(result)).not.toContain("0000000009");
    expect(writes(calls)).toHaveLength(1);
  });
});
