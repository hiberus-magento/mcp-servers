// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.15): when a bulk publish response names
// `/.helix/config` among ignored paths, the result must surface it, not
// silently drop the information (eds-client spec, "Bulk Write Ignored-Path
// Reporting").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { AdminApiAuthError, AdminApiStatusError } from "../errors.js";
import { createHttpClient } from "../http.js";
import { publishPath, setLiveState, unpublishPath } from "./live.js";

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

describe("setLiveState", () => {
  it("surfaces /.helix/config as an ignored path when the response reports it", async () => {
    const path = "/live/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: {
        status: 200,
        body: { job: { name: "job-1", topic: "live", state: "completed" }, links: { self: "https://admin.hlx.page/job/1" }, ignoredPaths: ["/.helix/config"] },
      },
    });

    const result = await setLiveState(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      paths: ["/index.html", "/.helix/config"],
      state: "published",
    });

    expect(result.ignoredPaths).toContain("/.helix/config");
    // CHANGED DELIBERATELY (eds-write-surface tasks.md 2.7b): this asserted
    // `{ paths, state: "published" }`. The contract's bulk body is
    // `{ paths, delete?, forceUpdate?, forceAsync? }` — there is no `state`
    // field, so "unpublished" was never sent as anything the API reads.
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/index.html", "/.helix/config"] });
  });

  // RED-first (tasks.md 2.7b): the defect itself. An unpublish must say
  // `delete: true` in the body, or the API sees a plain bulk publish.
  it("sends delete: true for an unpublish, and never a state field", async () => {
    const path = "/live/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: { status: 202, body: { job: { name: "job-2", topic: "live", state: "created" }, links: { self: "https://admin.hlx.page/job/2" } } },
    });

    await setLiveState(http, { org: "acme-demo-org", site: "acme-demo-site-eu", paths: ["/a", "/b"], state: "unpublished" });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/a", "/b"], delete: true });
  });

  // RED-first: observed live, publishing a path with nothing in preview
  // answered a non-ok status with a zero-byte body and the operator was
  // told `Unexpected end of JSON input`. A failed publish must report the
  // status and the path it was writing.
  it("reports the status and the path when the publish fails with a zero-byte body", async () => {
    const path = "/live/acme-demo-org/acme-demo-site-eu/main/*";
    const { http } = makeHttp({ [`POST ${path}`]: { status: 400 } });

    const error = await setLiveState(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      paths: ["/missing-from-preview"],
      state: "published",
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AdminApiStatusError);
    expect((error as AdminApiStatusError).status).toBe(400);
    expect((error as AdminApiStatusError).message).toContain("POST");
    expect((error as AdminApiStatusError).message).toContain(path);
    expect((error as AdminApiStatusError).message).not.toContain("JSON input");
  });

  it("names the credential when the publish is rejected for permissions", async () => {
    const path = "/live/acme-demo-org/acme-demo-site-eu/main/*";
    const { http } = makeHttp({ [`POST ${path}`]: { status: 403 } });

    const error = await setLiveState(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      paths: ["/index.html"],
      state: "published",
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AdminApiAuthError);
    expect((error as AdminApiAuthError).message).toContain("EDS_TOKEN");
  });
});

// RED-first (eds-write-surface tasks.md 2.7): single-path publish and
// unpublish beside the bulk job (eds-client spec, "Single-Path and Bulk
// Preview, Live and Index Operations").
describe("publishPath / unpublishPath", () => {
  it("POSTs one path under /live/ with no body", async () => {
    const { http, calls } = makeHttp({ "POST /live/acme-demo-org/acme-demo-site-eu/main/products/demo": { status: 200, body: { live: { status: 200 } } } });

    const result = await publishPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", path: "/products/demo" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
    expect(result).toEqual({ hasResponse: true, response: { live: { status: 200 } } });
  });

  it("DELETEs one path under /live/ on the requested ref", async () => {
    const { http, calls } = makeHttp({ "DELETE /live/acme-demo-org/acme-demo-site-eu/feature/products/demo": { status: 204 } });

    await expect(unpublishPath(http, { org: "acme-demo-org", site: "acme-demo-site-eu", ref: "feature", path: "/products/demo" })).resolves.toEqual({
      hasResponse: false,
    });
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});
