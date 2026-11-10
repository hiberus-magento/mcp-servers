// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.11): the existence check for a site-config write
// MUST be a `GET` performed before the `PUT`, never a caught `409` on the
// `PUT` itself — that 409-on-existing-PUT behavior is inferred only from
// the old Python CLI, not confirmed by Adobe's docs (eds-client spec,
// "Config Write Existence Check via GET-Before-Write").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { AdminApiStatusError, SiteExistenceError } from "../errors.js";
import { createHttpClient } from "../http.js";
import { createSite, deleteSite, getSiteConfig, listConfigVersions, listSites, restoreConfigVersion, updateSiteConfig } from "./site-config.js";

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

// RED-first (eds-write-surface tasks.md 2.1/2.2): `putSiteConfig` always sent
// `PUT`, but the contract says `PUT` creates (409 if the site exists) and
// `POST` updates. Creation and update are now two functions, each with its
// own GET-before-write precondition, and neither falls through to the other.
const SITE_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu.json";
const SITE = { org: "acme-demo-org", site: "acme-demo-site-eu" };

describe("createSite", () => {
  it("issues a GET answered 404, then a PUT with the config", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 404 },
      [`PUT ${SITE_PATH}`]: { status: 200, body: { ok: true } },
    });

    const result = await createSite(http, SITE, { content: { source: { type: "markup" } } });

    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({ content: { source: { type: "markup" } } });
    expect(result).toEqual({ hasResponse: true, response: { ok: true } });
  });

  it("fails naming the existing site, without issuing a PUT, when the GET answers 200", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 200, body: { name: "acme-demo-site-eu" } },
      [`PUT ${SITE_PATH}`]: { status: 200, body: { ok: true } },
    });

    const error = await createSite(http, SITE, {}).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SiteExistenceError);
    expect((error as SiteExistenceError).message).toContain("acme-demo-site-eu");
    expect((error as SiteExistenceError).expected).toBe("absent");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("fails with the status when the existence GET returns a status it never asked for", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 403 },
      [`PUT ${SITE_PATH}`]: { status: 200, body: { ok: true } },
    });

    await expect(createSite(http, SITE, {})).rejects.toThrowError(/403/);
    expect(calls).toHaveLength(1);
  });

  it("reports a PUT that answers with no body as hasResponse: false", async () => {
    const { http } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 404 },
      [`PUT ${SITE_PATH}`]: { status: 204 },
    });

    await expect(createSite(http, SITE, {})).resolves.toEqual({ hasResponse: false });
  });
});

describe("updateSiteConfig", () => {
  it("issues a GET answered 200, then a POST to the same path with the config", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 200, body: { name: "acme-demo-site-eu" } },
      [`POST ${SITE_PATH}`]: { status: 200, body: { ok: true } },
    });

    const result = await updateSiteConfig(http, SITE, { title: "Demo" });

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([`GET ${SITE_PATH}`, `POST ${SITE_PATH}`]);
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({ title: "Demo" });
    expect(result).toEqual({ hasResponse: true, response: { ok: true } });
  });

  it("fails without issuing a POST when the site does not exist", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SITE_PATH}`]: { status: 404 },
      [`POST ${SITE_PATH}`]: { status: 200, body: { ok: true } },
    });

    const error = await updateSiteConfig(http, SITE, {}).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SiteExistenceError);
    expect((error as SiteExistenceError).expected).toBe("present");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });
});

describe("listSites", () => {
  it("reads the documented { sites: [{ name }] } shape as names", async () => {
    const { http, calls } = makeHttp({
      "GET /config/acme-demo-org/sites.json": { status: 200, body: { sites: [{ name: "acme-demo-site-eu" }, { name: "acme-demo-site-us" }] } },
    });

    await expect(listSites(http, { org: "acme-demo-org" })).resolves.toEqual({ sites: ["acme-demo-site-eu", "acme-demo-site-us"] });
    expect(calls).toHaveLength(1);
  });

  it("reads a bare-array response the same way", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites.json": { status: 200, body: ["acme-demo-site-eu"] },
    });

    await expect(listSites(http, { org: "acme-demo-org" })).resolves.toEqual({ sites: ["acme-demo-site-eu"] });
  });
});

describe("deleteSite", () => {
  it("issues exactly one DELETE on the site document", async () => {
    const { http, calls } = makeHttp({
      [`DELETE ${SITE_PATH}`]: { status: 204 },
    });

    await expect(deleteSite(http, SITE)).resolves.toEqual({ hasResponse: false });
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});

describe("listConfigVersions", () => {
  it("reads the site's versions document", async () => {
    const versions = { current: 3, versions: [{ version: 3, created: "2026-01-01T00:00:00Z", name: "v3" }] };
    const { http } = makeHttp({
      "GET /config/acme-demo-org/sites/acme-demo-site-eu/versions.json": { status: 200, body: versions },
    });

    await expect(listConfigVersions(http, SITE)).resolves.toEqual(versions);
  });
});

describe("restoreConfigVersion", () => {
  it("targets the restoreVersion query parameter with a POST and no body", async () => {
    const { http, calls } = makeHttp({
      "POST /config/acme-demo-org/sites/acme-demo-site-eu.json?restoreVersion=v-demo-1": { status: 200, body: { version: 4 } },
    });

    const result = await restoreConfigVersion(http, { ...SITE, versionId: "v-demo-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
    expect(result).toEqual({ hasResponse: true, response: { version: 4 } });
  });

  it("encodes the version id so it cannot add query parameters", async () => {
    const { http, calls } = makeHttp({
      "POST /config/acme-demo-org/sites/acme-demo-site-eu.json?restoreVersion=v%26x%3D1": { status: 200, body: {} },
    });

    await restoreConfigVersion(http, { ...SITE, versionId: "v&x=1" });

    expect(new URL(calls[0]?.url ?? "").searchParams.get("restoreVersion")).toBe("v&x=1");
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
