// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.17): `eds_reindex`'s full-site branch must never
// send a bodyless POST, and the paths branch must send submitted paths
// verbatim.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { indexPath, reindex, unindexPath } from "./index-ops.js";

function makeHttp(routes: Record<string, unknown>) {
  const { fetch, calls } = createFetchDouble(routes as never);
  const http = createHttpClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: "k" }),
      invalidate: () => undefined,
      describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
    },
    baseUrl: "https://admin.hlx.page",
    org: "acme-demo-org",
  });
  return { http, calls };
}

describe("reindex", () => {
  // CHANGED DELIBERATELY (eds-write-surface design.md D1, tasks.md 2.8b):
  // this asserted the opposite — "never a bodyless POST", sending an
  // invented `{ scope: "full-site" }`. The contract documents the bodyless
  // POST as exactly the full-site reindex, and its body schema has only
  // `paths`. The hazard the old rule guarded (an accidental bodyless call)
  // is now gated by the `confirmFullReindex: true` literal and plan/apply.
  it("sends the documented bodyless POST on the full-site branch", async () => {
    const path = "/index/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: { status: 200, body: { job: { name: "j", topic: "index", state: "running" }, links: { self: "s" } } },
    });

    await reindex(http, { org: "acme-demo-org", site: "acme-demo-site-eu", request: { scope: "full-site", confirmFullReindex: true } });

    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
  });

  it("sends submitted paths verbatim on the paths branch", async () => {
    const path = "/index/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: { status: 200, body: { job: { name: "j", topic: "index", state: "running" }, links: { self: "s" } } },
    });

    await reindex(http, { org: "acme-demo-org", site: "acme-demo-site-eu", request: { scope: "paths", paths: ["/a.html", "/b.html"] } });

    // CHANGED DELIBERATELY (tasks.md 2.8b): exactly `{ paths }` — `scope` is
    // not in the contract's body schema.
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/a.html", "/b.html"] });
  });
});

// RED-first (eds-write-surface tasks.md 2.8): single-path index update and
// removal. Removal has no bulk form in the contract.
describe("indexPath / unindexPath", () => {
  it("POSTs one path under /index/ with no body", async () => {
    const { http, calls } = makeHttp({ "POST /index/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 200, body: { index: {} } } });

    await expect(indexPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" })).resolves.toEqual({
      hasResponse: true,
      response: { index: {} },
    });
    expect(calls[0]?.body).toBeUndefined();
  });

  it("DELETEs one path under /index/", async () => {
    const { http, calls } = makeHttp({ "DELETE /index/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 204 } });

    await unindexPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" });

    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});
