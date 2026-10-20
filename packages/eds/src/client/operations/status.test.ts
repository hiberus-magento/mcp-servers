// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.16, shared with live.ts): status per-partition
// object for a single path, and a bulk status call returning the job
// envelope for `waitForJob` to poll.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { AdminApiAuthError } from "../errors.js";
import { createHttpClient } from "../http.js";
import { getStatus, getStatusBulk, readBulkStatusResults } from "./status.js";

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

describe("getStatus", () => {
  it("returns the per-partition status object for a single path", async () => {
    const path = "/status/acme-demo-org/acme-demo-site-eu/main/index.html";
    const { http } = makeHttp({
      [`GET ${path}`]: { status: 200, body: { edit: {}, preview: {}, live: {}, code: {}, index: {} } },
    });

    const result = await getStatus(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/index.html" });

    expect(result).toHaveProperty("edit");
    expect(result).toHaveProperty("live");
  });
});

describe("getStatusBulk", () => {
  it("issues a bulk status POST returning a job envelope", async () => {
    const path = "/status/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: {
        status: 200,
        body: { job: { name: "job-2", topic: "status", state: "running" }, links: { self: "https://admin.hlx.page/job/2" } },
      },
    });

    const result = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/a.html", "/b.html"] });

    expect(result.job.state).toBe("running");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/a.html", "/b.html"] });
  });

  // RED-first: observed live, a token without the bulk-status permission
  // gets a 403 with a zero-byte body and the operator was told
  // `Unexpected end of JSON input` — a permission problem reported as a
  // parse failure.
  it("reports a 403 with a zero-byte body as a credential problem, not a parse failure", async () => {
    const path = "/status/acme-demo-org/acme-demo-site-eu/main/*";
    const { http } = makeHttp({ [`POST ${path}`]: { status: 403 } });

    const error = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/a.html"] }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AdminApiAuthError);
    expect((error as AdminApiAuthError).status).toBe(403);
    expect((error as AdminApiAuthError).message).toContain("permission");
    expect((error as AdminApiAuthError).message).toContain("hiberus-eds auth token set");
    expect((error as AdminApiAuthError).message).not.toContain("JSON input");
  });
});

// RED-first: observed live against the Admin API — the bulk-status POST
// returns 200 with the job ALREADY completed and its per-path results
// inline at `job.data.resources`. The follow-up GET this code used to issue
// (`/job/{org}/{site}/{ref}/status/{name}`, the job's own `links.self`)
// answers 404 `[AWS] Not Found`, and `GET .../status` lists `jobs: []` —
// completed jobs are not retained, so that poll could never succeed.
const BULK_POST_PATH = "/status/acme-demo-org/acme-demo-site-eu/main/*";

/** The shape of a real 200 response, with synthetic identifiers throughout. */
const COMPLETED_BULK_BODY = {
  job: {
    topic: "status",
    user: "demo-author@example-domain",
    name: "job-2026-10-20t00-00-00-000z",
    state: "stopped",
    createTime: "2026-10-20T00:00:00.000Z",
    startTime: "2026-10-20T00:00:00.100Z",
    stopTime: "2026-10-20T00:00:00.900Z",
    invocationId: "00000000-0000-4000-8000-000000000000",
    data: {
      paths: [{ path: "/" }, { path: "/drafts/test" }],
      pathsOnly: false,
      select: ["preview", "live"],
      phase: "completed",
      resources: [
        {
          path: "/",
          previewLastModified: "Mon, 19 Oct 2026 10:00:00 GMT",
          previewSourceLastModified: "Mon, 19 Oct 2026 09:59:00 GMT",
          previewLastModifiedBy: "demo-author@example-domain",
          publishLastModified: "Mon, 19 Oct 2026 10:01:00 GMT",
          publishSourceLastModified: "Mon, 19 Oct 2026 09:59:00 GMT",
          publishLastModifiedBy: "demo-author@example-domain",
        },
      ],
    },
  },
  links: {
    list: "https://admin.hlx.page/job/acme-demo-org/acme-demo-site-eu/main/status",
    self: "https://admin.hlx.page/job/acme-demo-org/acme-demo-site-eu/main/status/job-2026-10-20t00-00-00-000z",
  },
};

describe("getStatusBulk — a job that is already finished when the POST returns", () => {
  it("reads the per-path results inline from job.data.resources and issues NO job GET", async () => {
    // No GET route is registered on purpose: the fetch double throws on an
    // unregistered route, so a follow-up poll fails this test loudly.
    const { http, calls } = makeHttp({ [`POST ${BULK_POST_PATH}`]: { status: 200, body: COMPLETED_BULK_BODY } });

    const result = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/", "/drafts/test"] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(result.results).toEqual([
      {
        path: "/",
        previewLastModified: "Mon, 19 Oct 2026 10:00:00 GMT",
        previewSourceLastModified: "Mon, 19 Oct 2026 09:59:00 GMT",
        previewLastModifiedBy: "demo-author@example-domain",
        publishLastModified: "Mon, 19 Oct 2026 10:01:00 GMT",
        publishSourceLastModified: "Mon, 19 Oct 2026 09:59:00 GMT",
        publishLastModifiedBy: "demo-author@example-domain",
      },
    ]);
  });

  // A path with no content is simply ABSENT from `resources`. That absence
  // is the answer the caller asked for, so it is reported by name rather
  // than dropped silently or dressed up as a per-path 404.
  it("names a requested path that is absent from resources instead of dropping it", async () => {
    const { http } = makeHttp({ [`POST ${BULK_POST_PATH}`]: { status: 200, body: COMPLETED_BULK_BODY } });

    const result = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/", "/drafts/test"] });

    expect(result.missingPaths).toEqual(["/drafts/test"]);
  });

  it("copies the job and each resource field by field — no undeclared key reaches the result", async () => {
    const { http } = makeHttp({ [`POST ${BULK_POST_PATH}`]: { status: 200, body: COMPLETED_BULK_BODY } });

    const result = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/"] });

    expect(Object.keys(result.job).sort()).toEqual(["name", "state", "topic"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("invocationId");
    expect(serialized).not.toContain("pathsOnly");
  });

  it("leaves results absent and keeps the self link when the job has not completed", async () => {
    const running = {
      job: { topic: "status", name: "job-running", state: "running", data: { phase: "running" } },
      links: { self: "https://admin.hlx.page/job/acme-demo-org/acme-demo-site-eu/main/status/job-running" },
    };
    const { http } = makeHttp({ [`POST ${BULK_POST_PATH}`]: { status: 200, body: running } });

    const result = await getStatusBulk(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/"] });

    expect(result.results).toBeUndefined();
    expect(result.missingPaths).toBeUndefined();
    expect(result.links.self).toBe(running.links.self);
  });
});

describe("readBulkStatusResults", () => {
  it("returns undefined for a job that carries no completed phase, so the caller still polls", () => {
    expect(readBulkStatusResults({ state: "running", data: { phase: "running", resources: [] } }, ["/"])).toBeUndefined();
    expect(readBulkStatusResults({ state: "stopped" }, ["/"])).toBeUndefined();
  });

  it("reads a completed job handed to it after polling, the same way the POST body is read", () => {
    const parsed = readBulkStatusResults(COMPLETED_BULK_BODY.job, ["/", "/drafts/test"]);
    expect(parsed?.results.map((r) => r.path)).toEqual(["/"]);
    expect(parsed?.missingPaths).toEqual(["/drafts/test"]);
  });
});
