// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 2.6): preview update/delete for one
// path, and the bulk preview job with an explicit body — `delete: true` to
// remove — that keeps reporting ignored paths (eds-client spec, "Single-Path
// and Bulk Preview, Live and Index Operations").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { previewBulk, previewPath, unpreviewPath } from "./preview.js";

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

const BULK = "/preview/acme-demo-org/acme-demo-site-eu/main/*";
const JOB = { job: { name: "job-3", topic: "preview", state: "created" }, links: { self: "https://admin.hlx.page/job/3" } };

describe("previewPath / unpreviewPath", () => {
  it("POSTs one path under /preview/ with no body", async () => {
    const { http, calls } = makeHttp({ "POST /preview/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 200, body: { preview: { status: 200 } } } });

    await expect(previewPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" })).resolves.toEqual({
      hasResponse: true,
      response: { preview: { status: 200 } },
    });
    expect(calls[0]?.body).toBeUndefined();
  });

  it("DELETEs one path under /preview/", async () => {
    const { http, calls } = makeHttp({ "DELETE /preview/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 204 } });

    await expect(unpreviewPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" })).resolves.toEqual({ hasResponse: false });
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});

describe("previewBulk", () => {
  it("sends exactly { paths } to update and surfaces ignored paths", async () => {
    const { http, calls } = makeHttp({ [`POST ${BULK}`]: { status: 202, body: { ...JOB, ignoredPaths: ["/redirects.json"] } } });

    const result = await previewBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/a", "/redirects.json"], remove: false });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/a", "/redirects.json"] });
    expect(result).toEqual({ job: JOB.job, links: JOB.links, ignoredPaths: ["/redirects.json"] });
  });

  it("sends { paths, delete: true } to remove", async () => {
    const { http, calls } = makeHttp({ [`POST ${BULK}`]: { status: 202, body: JOB } });

    const result = await previewBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/a", "/b"], remove: true });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/a", "/b"], delete: true });
    expect(result.ignoredPaths).toEqual([]);
  });
});
