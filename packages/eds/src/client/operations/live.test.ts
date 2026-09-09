// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.15): when a bulk publish response names
// `/.helix/config` among ignored paths, the result must surface it, not
// silently drop the information (eds-client spec, "Bulk Write Ignored-Path
// Reporting").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { setLiveState } from "./live.js";

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
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/index.html", "/.helix/config"], state: "published" });
  });
});
