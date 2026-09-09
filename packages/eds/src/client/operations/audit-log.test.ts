// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.19): the audit-log operation passes through
// `since`/`nextToken` and returns the response's `nextToken` for the
// caller to continue — never auto-draining.
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { getAuditLog } from "./audit-log.js";

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

describe("getAuditLog", () => {
  it("passes through since and nextToken, and returns the response's nextToken", async () => {
    const path = "/log/acme-demo-org/acme-demo-site-eu/main?since=2026-01-01&nextToken=page-2";
    const { http, calls } = makeHttp({
      [`GET ${path}`]: { status: 200, body: { entries: [{ id: "e1" }], nextToken: "page-3" } },
    });

    const result = await getAuditLog(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      since: "2026-01-01",
      nextToken: "page-2",
    });

    expect(result.entries).toEqual([{ id: "e1" }]);
    expect(result.nextToken).toBe("page-3");
    expect(calls[0]?.url).toContain("since=2026-01-01");
    expect(calls[0]?.url).toContain("nextToken=page-2");
  });

  it("never auto-drains — one call returns exactly one page", async () => {
    const path = "/log/acme-demo-org/acme-demo-site-eu/main";
    const { http, calls } = makeHttp({
      [`GET ${path}`]: { status: 200, body: { entries: [{ id: "e1" }], nextToken: "page-2" } },
    });

    await getAuditLog(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(calls).toHaveLength(1);
  });
});
