// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-content-config tasks.md 1.1): with the configuration service
// the index and sitemap definitions of a site are YAML documents under
// `/config/{org}/sites/{site}/content/`, read and written as `text/yaml`.
// A site that never had one answers 404, which is a state, not a failure.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { contentConfigPath, getContentConfig, setContentConfig } from "./content-config.js";

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

const SITE = { org: "acme-demo-org", site: "acme-demo-site-eu" };
const QUERY_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu/content/query.yaml";
const YAML = "version: 1\nindices:\n  demo:\n    target: /demo.json\n";

describe("contentConfigPath", () => {
  it.each(["query.yaml", "sitemap.yaml"] as const)("addresses %s under the site's content folder", (file) => {
    expect(contentConfigPath({ ...SITE, file })).toBe(`/config/acme-demo-org/sites/acme-demo-site-eu/content/${file}`);
  });
});

describe("getContentConfig", () => {
  it("returns the document as text, unparsed", async () => {
    const { http } = makeHttp({ [`GET ${QUERY_PATH}`]: { status: 200, headers: { "content-type": "text/yaml" }, body: YAML } });

    await expect(getContentConfig(http, { ...SITE, file: "query.yaml" })).resolves.toBe(YAML);
  });

  it("returns null when the site has no such document (404)", async () => {
    const { http } = makeHttp({ [`GET ${QUERY_PATH}`]: { status: 404, headers: { "x-error": "[AWS] Not Found" } } });

    await expect(getContentConfig(http, { ...SITE, file: "query.yaml" })).resolves.toBeNull();
  });

  it("still fails on any other error status", async () => {
    const { http } = makeHttp({ [`GET ${QUERY_PATH}`]: { status: 500 } });

    await expect(getContentConfig(http, { ...SITE, file: "query.yaml" })).rejects.toThrow();
  });
});

describe("setContentConfig", () => {
  it("POSTs exactly the content with content-type text/yaml when the document exists", async () => {
    const { http, calls } = makeHttp({ [`POST ${QUERY_PATH}`]: { status: 204 } });

    await setContentConfig(http, { ...SITE, file: "query.yaml", content: YAML, exists: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("text/yaml");
    expect(calls[0]?.body).toBe(YAML);
  });

  it("PUTs (creates) the document when the site has none", async () => {
    const { http, calls } = makeHttp({ [`PUT ${QUERY_PATH}`]: { status: 201 } });

    await setContentConfig(http, { ...SITE, file: "query.yaml", content: YAML, exists: false });

    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers["content-type"]).toBe("text/yaml");
  });
});
