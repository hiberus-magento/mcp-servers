// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface Phase 4, groundwork for 4.1/4.9): `eds_plan`
// records each write as a `PlannedRequest` built WITHOUT sending it, and
// `eds_apply` replays it. A builder that drifted from the typed client
// function for the same operation would make the plan show one request and
// the typed path (CLI) send another, so every builder is checked against the
// request its typed twin actually puts on the wire.
import { describe, expect, it } from "vitest";
import { createFetchDouble, type RecordedCall } from "../testing/fetch-double.js";
import { createHttpClient, type HttpClient } from "./http.js";
import { sendPlannedRequest, type PlannedRequest } from "./planned-request.js";
import { writeRequests } from "./write-requests.js";
import { createSite, deleteSite, getSiteDocument, restoreConfigVersion, siteExists, updateSiteConfig } from "./operations/site-config.js";
import { setRobots } from "./operations/robots.js";
import { previewBulk, previewPath, unpreviewPath } from "./operations/preview.js";
import { publishPath, submitBulkJob, unpublishPath } from "./operations/live.js";
import { indexPath, reindex, unindexPath } from "./operations/index-ops.js";
import { purgeCache } from "./operations/cache.js";
import { rebuildSitemap } from "./operations/sitemap.js";
import { deleteCode, syncCode } from "./operations/code.js";
import { stopJob } from "./jobs.js";
import { addToSnapshot, deleteSnapshot, publishSnapshot, removeFromSnapshot, reviewSnapshot } from "./operations/snapshots.js";

const SITE = { org: "acme-demo-org", site: "acme-demo-site-eu" } as const;
const SITE_DOC_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
const JOB_BODY = {
  job: { name: "job-demo", topic: "live", state: "created" },
  links: { self: "https://admin.hlx.page/job/acme-demo-org/acme-demo-site-eu/main/live/job-demo" },
};

/** Answers every write with a job body, and the site-document GET with whatever `getStatus` says. */
function makeHttp(getStatus = 404): { http: HttpClient; calls: readonly RecordedCall[] } {
  const handler = (call: RecordedCall) => {
    if (call.method === "GET") return { status: getStatus, body: getStatus === 200 ? { a: 1 } : undefined };
    return { status: 200, body: JOB_BODY };
  };
  const { fetch, calls } = createFetchDouble(new Proxy({}, { get: () => handler, has: () => true }) as never);
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

function wire(call: RecordedCall | undefined) {
  return { method: call?.method, url: call?.url, body: call?.body, contentType: call?.headers["content-type"] };
}

/** The last request the typed function sent, and the one the builder's request replays as. */
async function compare(typed: (http: HttpClient) => Promise<unknown>, planned: PlannedRequest, getStatus?: number) {
  const viaTyped = makeHttp(getStatus);
  await typed(viaTyped.http);
  const viaPlan = makeHttp(getStatus);
  await sendPlannedRequest(viaPlan.http, planned);
  expect(viaPlan.calls).toHaveLength(1);
  expect(wire(viaPlan.calls[0])).toEqual(wire(viaTyped.calls.at(-1)));
}

const CONTENT = { ...SITE, ref: "main", path: "/products/demo" };
const PATHS = ["/products/demo", "/products/other"] as const;
const CODE = { owner: "example-owner", repo: "example-repo", ref: "main", path: "/scripts/demo.js" };
const SNAPSHOT = { ...SITE, id: "launch-demo" };

describe("writeRequests — each builder records what its typed client function sends", () => {
  it("site.update: POST of the full document", async () => {
    await compare((http) => updateSiteConfig(http, SITE, { a: 2 }), writeRequests.siteUpdate(SITE, { a: 2 }), 200);
  });

  it("site.create: PUT of the document", async () => {
    await compare((http) => createSite(http, SITE, { a: 2 }), writeRequests.siteCreate(SITE, { a: 2 }), 404);
  });

  it("site.delete: DELETE with no body", async () => {
    await compare((http) => deleteSite(http, SITE), writeRequests.siteDelete(SITE));
  });

  it("version.restore: POST with the id URL-encoded and no body", async () => {
    const options = { ...SITE, versionId: "v 1&x=y" };
    await compare((http) => restoreConfigVersion(http, options), writeRequests.versionRestore(options));
  });

  it("robots.set: POST of the text as text/plain", async () => {
    const options = { ...SITE, content: "User-agent: *\nDisallow: /" };
    await compare((http) => setRobots(http, options), writeRequests.robotsSet(options));
  });

  it.each([
    ["preview", "POST", previewPath],
    ["preview", "DELETE", unpreviewPath],
    ["live", "POST", publishPath],
    ["live", "DELETE", unpublishPath],
    ["index", "POST", indexPath],
    ["index", "DELETE", unindexPath],
  ] as const)("%s %s on one path", async (resource, method, typed) => {
    await compare((http) => typed(http, CONTENT), writeRequests.contentPath(resource, method, CONTENT));
  });

  it.each([
    ["preview", false],
    ["preview", true],
    ["live", false],
    ["live", true],
  ] as const)("%s bulk (remove: %s)", async (resource, remove) => {
    const options = { ...SITE, ref: "main", paths: PATHS, remove };
    const typed = resource === "preview" ? (http: HttpClient) => previewBulk(http, options) : (http: HttpClient) => submitBulkJob(http, "live", options);
    await compare(typed, writeRequests.contentBulk(resource, options));
  });

  it("index.update bulk: POST of exactly { paths }", async () => {
    const options = { ...SITE, ref: "main", paths: PATHS };
    await compare((http) => reindex(http, { ...options, request: { scope: "paths", paths: PATHS } }), writeRequests.indexBulk(options));
  });

  it("index.full-site: the bodyless POST", async () => {
    const options = { ...SITE, ref: "main" };
    await compare(
      (http) => reindex(http, { ...options, request: { scope: "full-site", confirmFullReindex: true } }),
      writeRequests.indexFullSite(options),
    );
  });

  it("cache.purge and sitemap.rebuild: POST on one path", async () => {
    await compare((http) => purgeCache(http, CONTENT), writeRequests.cachePurge(CONTENT));
    await compare((http) => rebuildSitemap(http, CONTENT), writeRequests.sitemapRebuild(CONTENT));
  });

  it("code.sync / code.delete", async () => {
    await compare((http) => syncCode(http, CODE), writeRequests.code("POST", CODE));
    await compare((http) => deleteCode(http, CODE), writeRequests.code("DELETE", CODE));
  });

  it("job.stop", async () => {
    const options = { ...SITE, ref: "main", topic: "live", name: "job-demo" };
    await compare((http) => stopJob(http, options), writeRequests.jobStop(options));
  });

  it("snapshot add / remove / publish / review / delete", async () => {
    await compare((http) => addToSnapshot(http, { ...SNAPSHOT, paths: PATHS }), writeRequests.snapshotAdd({ ...SNAPSHOT, paths: PATHS }));
    await compare((http) => addToSnapshot(http, SNAPSHOT), writeRequests.snapshotAdd(SNAPSHOT));
    await compare((http) => removeFromSnapshot(http, { ...SNAPSHOT, paths: PATHS }), writeRequests.snapshotRemove({ ...SNAPSHOT, paths: PATHS }));
    await compare((http) => publishSnapshot(http, SNAPSHOT), writeRequests.snapshotPublish(SNAPSHOT));
    const review = { ...SNAPSHOT, reviewAction: "approve", message: "ok" } as const;
    await compare((http) => reviewSnapshot(http, review), writeRequests.snapshotReview(review));
    await compare((http) => deleteSnapshot(http, SNAPSHOT), writeRequests.snapshotDelete(SNAPSHOT));
  });
});

describe("reads a plan needs (site document, existence)", () => {
  it("getSiteDocument reads only the site document — never the CDN or effective config", async () => {
    const { http, calls } = makeHttp(200);

    await expect(getSiteDocument(http, SITE)).resolves.toEqual({ a: 1 });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([`GET ${SITE_DOC_PATH}`]);
  });

  it("siteExists answers false on 404 and true on 200", async () => {
    await expect(siteExists(makeHttp(404).http, SITE)).resolves.toBe(false);
    await expect(siteExists(makeHttp(200).http, SITE)).resolves.toBe(true);
  });
});
