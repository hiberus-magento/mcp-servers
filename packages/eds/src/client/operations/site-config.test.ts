// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.11): the existence check for a site-config write
// MUST be a `GET` performed before the `PUT`, never a caught `409` on the
// `PUT` itself — that 409-on-existing-PUT behavior is inferred only from
// the old Python CLI, not confirmed by Adobe's docs (eds-client spec,
// "Config Write Existence Check via GET-Before-Write").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { AdminApiStatusError } from "../errors.js";
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

  // The existence GET is the one place in the client that *asks* for a
  // non-ok status, so it must opt out explicitly rather than be rescued by
  // the transport returning failures silently.
  it("reads a 404 on the existence GET as 'did not exist', not as a transport failure", async () => {
    const configPath = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
    const { http } = makeHttp({
      [`GET ${configPath}`]: { status: 404 },
      [`PUT ${configPath}`]: { status: 200, body: { ok: true } },
    });

    const result = await putSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }, { content: { source: { type: "markup" } } });

    expect(result.existed).toBe(false);
    expect(result.response).toEqual({ ok: true });
  });

  it("fails with the status when the existence GET returns a status it never asked for", async () => {
    const configPath = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
    const { http } = makeHttp({
      [`GET ${configPath}`]: { status: 403 },
      [`PUT ${configPath}`]: { status: 200, body: { ok: true } },
    });

    await expect(putSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }, {})).rejects.toThrowError(/403/);
  });
});

describe("getSiteConfig", () => {
  it("aggregates site doc, CDN, and effective config into one merged object", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu.json": { status: 200, body: { site: "doc" } },
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/cdn.json": { status: 200, body: { cdn: "config" } },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: { effective: "config" } },
    });

    const result = await getSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result.site).toEqual({ site: "doc" });
    expect(result.cdn).toEqual({ cdn: "config" });
    expect(result.effective).toEqual({ effective: "config" });
    expect(result.cdnPresent).toBe(true);
  });

  // RED-first. CHANGED DELIBERATELY: this case was written when the CDN
  // document was fetched from `/cdn/config.json`, which answered 400 live
  // and was read as "the CDN config endpoint rejected us". It was not. That
  // path is not an endpoint at all — it returns the same
  // `[admin] Error reading config: invalid object path.` as deliberate
  // nonsense, and absence there is 404, proven by requesting the same
  // document for a site that does not exist. The real path is `/cdn.json`.
  // This test stays because the behaviour it pins is still required: a 400
  // with a zero-byte body must name the failing document and its status
  // instead of dying on `Unexpected end of JSON input`, which is exactly
  // what hid the wrong path for as long as it did.
  it("fails with the status and the failing document when the CDN config 400s with a zero-byte body", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu.json": { status: 200, body: { site: "doc" } },
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/cdn.json": { status: 400 },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: { effective: "config" } },
    });

    const error = await getSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AdminApiStatusError);
    expect((error as AdminApiStatusError).status).toBe(400);
    expect((error as AdminApiStatusError).message).toContain("the CDN config");
    expect((error as AdminApiStatusError).message).toContain("/cdn.json");
    expect((error as AdminApiStatusError).message).not.toContain("JSON input");
  });

  it("reports the CDN config as absent on a 404 and still returns the other two documents", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu.json": { status: 200, body: { site: "doc" } },
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/cdn.json": { status: 404 },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: { effective: "config" } },
    });

    const result = await getSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result.cdnPresent).toBe(false);
    expect(result.cdn).toBeUndefined();
    expect(result.site).toEqual({ site: "doc" });
    expect(result.effective).toEqual({ effective: "config" });
  });

  it("fails loudly when the site document itself returns a non-ok status", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu.json": { status: 404 },
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/cdn.json": { status: 200, body: { cdn: "config" } },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: { effective: "config" } },
    });

    const error = await getSiteConfig(http, { org: "acme-demo-org", site: "acme-demo-site-eu" }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AdminApiStatusError);
    expect((error as AdminApiStatusError).message).toContain("the site document");
  });
});
