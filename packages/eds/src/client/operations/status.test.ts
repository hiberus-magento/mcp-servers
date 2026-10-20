// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.16, shared with live.ts): status per-partition
// object for a single path, and a bulk status call returning the job
// envelope for `waitForJob` to poll.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { AdminApiAuthError } from "../errors.js";
import { createHttpClient } from "../http.js";
import { getStatus, getStatusBulk } from "./status.js";

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
