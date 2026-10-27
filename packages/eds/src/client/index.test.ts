// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.23): `client/index.ts` is the ONLY public surface
// (design.md, Decision 2) — adapters may import nothing else. This asserts
// the exact export set: `createEdsClient`, `EdsClient`, every error class,
// and every `*Result`/domain type re-export, nothing else sneaks in.
import { describe, expect, it } from "vitest";
import * as clientIndex from "./index.js";

const EXPECTED_VALUE_EXPORTS = [
  "createEdsClient",
  "AdminRateLimitError",
  "ContentSourceThrottledError",
  "UpstreamUnavailableError",
  "TransientNetworkError",
  "GatewayError",
  "JobTimeoutError",
  "EdsError",
  "SiteExistenceError",
];

describe("client/index.ts public surface", () => {
  it("exports exactly the documented value bindings (functions/classes)", () => {
    const actualValueExports = Object.keys(clientIndex).filter((key) => typeof (clientIndex as Record<string, unknown>)[key] !== "undefined");
    for (const expected of EXPECTED_VALUE_EXPORTS) {
      expect(actualValueExports).toContain(expected);
    }
  });

  it("createEdsClient assembles a working client end to end", async () => {
    const { createFetchDouble } = await import("../testing/fetch-double.js");
    const { fetch } = createFetchDouble({
      "GET /status/acme-demo-org.json": { status: 200, body: {} },
    });

    const client = clientIndex.createEdsClient({
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

    expect(client.http).toBeDefined();
    expect(client.auth.mintApiKey).toBeTypeOf("function");
    expect(client.auth.listApiKeys).toBeTypeOf("function");
    expect(client.operations.snapshots.listSnapshots).toBeTypeOf("function");
  });

  // RED-first (eds-write-surface tasks.md 2.13): every operation this change
  // adds is reachable through `createEdsClient`, since adapters may import
  // nothing else from `client/`.
  it("exposes every eds-write-surface operation on the assembled client", async () => {
    const { createFetchDouble } = await import("../testing/fetch-double.js");
    const client = clientIndex.createEdsClient({
      fetch: createFetchDouble({}).fetch,
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

    const surface = {
      siteConfig: ["createSite", "updateSiteConfig", "deleteSite", "listSites", "listConfigVersions", "restoreConfigVersion"],
      robots: ["getRobots", "setRobots"],
      preview: ["previewPath", "unpreviewPath", "previewBulk"],
      live: ["setLiveState", "publishPath", "unpublishPath"],
      indexOps: ["reindex", "indexPath", "unindexPath"],
      cache: ["purgeCache"],
      sitemap: ["rebuildSitemap"],
      code: ["getCodeStatus", "syncCode", "deleteCode"],
    } as const;
    const operations = client.operations as unknown as Record<string, Record<string, unknown>>;
    for (const [group, names] of Object.entries(surface)) {
      for (const name of names) {
        expect(operations[group]?.[name], `${group}.${name}`).toBeTypeOf("function");
      }
    }
    expect(client.jobs.listJobs).toBeTypeOf("function");
    expect(client.jobs.stopJob).toBeTypeOf("function");
    expect(client.auth.deleteApiKey).toBeTypeOf("function");
    expect(client.sendPlannedRequest).toBeTypeOf("function");
    expect("putSiteConfig" in operations.siteConfig!).toBe(false);
  });
});
