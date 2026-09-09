// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.11): the existence check for a site-config write
// MUST be a `GET` performed before the `PUT`, never a caught `409` on the
// `PUT` itself — that 409-on-existing-PUT behavior is inferred only from
// the old Python CLI, not confirmed by Adobe's docs (eds-client spec,
// "Config Write Existence Check via GET-Before-Write").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { getSiteConfig, putSiteConfig } from "./site-config.js";

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

describe("putSiteConfig", () => {
  it("issues a GET before the PUT, branching on that result — never the PUT's status code", async () => {
    const configPath = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
    const { http, calls } = makeHttp({
      [`GET ${configPath}`]: { status: 200, body: { exists: true } },
      [`PUT ${configPath}`]: { status: 200, body: { ok: true } },
    });

    await putSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }, { content: { source: { type: "markup" } } });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("PUT");
  });

  it("never treats a caught 409 on the PUT as the existence check — the GET result alone decides", async () => {
    const configPath = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
    const { http, calls } = makeHttp({
      [`GET ${configPath}`]: { status: 404, body: { exists: false } },
      [`PUT ${configPath}`]: { status: 200, body: { ok: true } },
    });

    await putSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }, { content: { source: { type: "markup" } } });

    // The GET happened first regardless of the PUT's eventual status — a
    // 409-catching implementation would never issue the GET at all.
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain(configPath);
  });
});

describe("getSiteConfig", () => {
  it("aggregates site doc, CDN, and effective config into one merged object", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu.json": { status: 200, body: { site: "doc" } },
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/cdn/config.json": { status: 200, body: { cdn: "config" } },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: { effective: "config" } },
    });

    const result = await getSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result.site).toEqual({ site: "doc" });
    expect(result.cdn).toEqual({ cdn: "config" });
    expect(result.effective).toEqual({ effective: "config" });
  });
});
