// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 2.5): `robots.txt` is the one site
// document the Admin API reads and writes as `text/plain`, not JSON
// (eds-client spec, "robots.txt Read and Write"). A JSON-encoded body would
// arrive as a quoted string with escaped newlines.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { getRobots, setRobots } from "./robots.js";

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

const ROBOTS_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu/robots.txt";
const SITE = { org: "acme-demo-org", site: "acme-demo-site-eu" };
const CONTENT = "User-agent: *\nDisallow: /";

describe("getRobots", () => {
  it("returns the body as text, unparsed", async () => {
    const { http } = makeHttp({ [`GET ${ROBOTS_PATH}`]: { status: 200, headers: { "content-type": "text/plain" }, body: CONTENT } });

    await expect(getRobots(http, SITE)).resolves.toBe(CONTENT);
  });

  it("returns an empty string for an empty robots.txt instead of failing", async () => {
    const { http } = makeHttp({ [`GET ${ROBOTS_PATH}`]: { status: 200, headers: { "content-type": "text/plain" }, body: "" } });

    await expect(getRobots(http, SITE)).resolves.toBe("");
  });
});

describe("setRobots", () => {
  it("POSTs exactly the content with content-type text/plain", async () => {
    const { http, calls } = makeHttp({ [`POST ${ROBOTS_PATH}`]: { status: 204 } });

    await setRobots(http, { ...SITE, content: CONTENT });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("text/plain");
    expect(calls[0]?.body).toBe(CONTENT);
  });
});
