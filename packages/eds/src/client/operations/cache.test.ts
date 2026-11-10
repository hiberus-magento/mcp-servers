// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 2.9): cache purge addresses ONE
// path per request, and sitemap rebuild targets the sitemap path (eds-client
// spec, "Cache Purge and Sitemap Rebuild"). Both may answer with no body.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { purgeCache } from "./cache.js";
import { rebuildSitemap } from "./sitemap.js";

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

describe("purgeCache", () => {
  it("POSTs one path under /cache/ with no body, returning the response as a plain object", async () => {
    const { http, calls } = makeHttp({ "POST /cache/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 200, body: { status: 200, path: "/products/demo" } } });

    const result = await purgeCache(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
    expect(result).toEqual({ hasResponse: true, response: { status: 200, path: "/products/demo" } });
  });
});

describe("rebuildSitemap", () => {
  it("POSTs the sitemap path on the requested ref and accepts a 204", async () => {
    const { http, calls } = makeHttp({ "POST /sitemap/acme-demo-org/acme-demo-site-eu/feature/sitemap.xml": { status: 204 } });

    await expect(rebuildSitemap(http, { org: "acme-demo-org", site: "acme-demo-site-eu", ref: "feature", path: "/sitemap.xml" })).resolves.toEqual({ hasResponse: false });
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });
});
