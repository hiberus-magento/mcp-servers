// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.17): `eds_reindex`'s full-site branch must never
// send a bodyless POST, and the paths branch must send submitted paths
// verbatim.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { reindex } from "./index-ops.js";

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
  it("never sends a bodyless POST on the full-site branch", async () => {
    const path = "/index/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: { status: 200, body: { job: { name: "j", topic: "index", state: "running" }, links: { self: "s" } } },
    });

    await reindex(http, { org: "acme-demo-org", site: "acme-demo-site-eu", request: { scope: "full-site", confirmFullReindex: true } });

    expect(calls[0]?.body).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ scope: "full-site" });
  });

  it("sends submitted paths verbatim on the paths branch", async () => {
    const path = "/index/acme-demo-org/acme-demo-site-eu/main/*";
    const { http, calls } = makeHttp({
      [`POST ${path}`]: { status: 200, body: { job: { name: "j", topic: "index", state: "running" }, links: { self: "s" } } },
    });

    await reindex(http, { org: "acme-demo-org", site: "acme-demo-site-eu", request: { scope: "paths", paths: ["/a.html", "/b.html"] } });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ scope: "paths", paths: ["/a.html", "/b.html"] });
  });
});
