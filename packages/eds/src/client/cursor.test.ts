// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.5): a paginated response's `nextToken` must
// round-trip through `fetchPage`, and the tool layer must never auto-drain
// (eds-client spec, "Cursor Pagination via nextToken").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../testing/fetch-double.js";
import { createHttpClient } from "./http.js";
import { fetchPage } from "./cursor.js";

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

describe("fetchPage", () => {
  it("round-trips nextToken from the response for the caller to continue", async () => {
    const path = "/log/acme-demo-org/acme-demo-site-eu/main";
    const { http } = makeHttp({
      [`GET ${path}`]: { status: 200, body: { entries: [{ id: "1" }], nextToken: "abc" } },
    });

    const page = await fetchPage(http, path);

    expect(page.nextToken).toBe("abc");
    expect(page.entries).toEqual([{ id: "1" }]);
  });

  it("passes a supplied nextToken through as a query parameter and never auto-drains", async () => {
    const path = "/log/acme-demo-org/acme-demo-site-eu/main";
    const { http, calls } = makeHttp({
      [`GET ${path}?nextToken=abc`]: { status: 200, body: { entries: [{ id: "2" }] } },
    });

    const page = await fetchPage(http, path, { nextToken: "abc" });

    expect(calls[0]?.url).toContain("nextToken=abc");
    expect(page.nextToken).toBeUndefined();
    expect(page.entries).toEqual([{ id: "2" }]);
  });
});
