// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.21): `mintApiKey()` returns a plain object — no
// rendering — and `authStatus()` probes the documented set of read
// endpoints, returning per-probe results, never the token itself.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../testing/fetch-double.js";
import { createHttpClient } from "./http.js";
import { authStatus, mintApiKey } from "./auth.js";

function makeHttp(routes: Record<string, unknown>) {
  const { fetch, calls } = createFetchDouble(routes as never);
  const http = createHttpClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: "test-only-secret-value" }),
      invalidate: () => undefined,
      describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
    },
    baseUrl: "https://admin.hlx.page",
    org: "acme-demo-org",
  });
  return { http, calls };
}

describe("mintApiKey", () => {
  it("returns a plain object with id/value/roles/expiresAt — no rendering", async () => {
    const path = "/config/acme-demo-org/sites/acme-demo-site-eu/apiKeys.json";
    const { http } = makeHttp({
      [`POST ${path}`]: { status: 200, body: { id: "key-1", value: "minted-secret-once", roles: ["publish"], expiresAt: "2027-01-01T00:00:00Z" } },
    });

    const result = await mintApiKey(http, { org: "acme-demo-org", site: "acme-demo-site-eu", roles: ["publish"] });

    expect(result).toEqual({ id: "key-1", value: "minted-secret-once", roles: ["publish"], expiresAt: "2027-01-01T00:00:00Z" });
  });
});

describe("authStatus", () => {
  it("probes org config, sites list, and site status, never returning the token value", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org.json": { status: 200, body: {} },
      "GET /config/acme-demo-org/sites.json": { status: 200, body: [] },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 200, body: {} },
    });

    const result = await authStatus(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result.probes).toHaveLength(3);
    expect(result.probes.every((p) => p.status === 200)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-only-secret-value");
  });

  it("omits the site status probe when no site is configured", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org.json": { status: 200, body: {} },
      "GET /config/acme-demo-org/sites.json": { status: 200, body: [] },
    });

    const result = await authStatus(http, { org: "acme-demo-org" });

    expect(result.probes).toHaveLength(2);
  });
});
