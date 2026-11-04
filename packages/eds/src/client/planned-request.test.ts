// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 2.15): `eds_apply` replays the
// requests recorded at plan time through this one entry point, so it is the
// client's only generic write. It must send exactly what it is given —
// method, path, body bytes, content type — and refuse anything that is not
// a write or that could leave the Admin API host (design.md, Open
// Questions, "How `eds_apply` replays requests").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../testing/fetch-double.js";
import { createHttpClient } from "./http.js";
import { sendPlannedRequest, type PlannedRequest } from "./planned-request.js";

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

const SITE_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu.json";

describe("sendPlannedRequest", () => {
  it("sends a JSON write with exactly the recorded method, path and body", async () => {
    const { http, calls } = makeHttp({ [`POST ${SITE_PATH}`]: { status: 200, body: { ok: true } } });
    const request: PlannedRequest = { method: "POST", path: SITE_PATH, body: { b: { c: 3 }, a: 1 } };

    const result = await sendPlannedRequest(http, request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe(SITE_PATH);
    expect(calls[0]?.body).toBe(JSON.stringify({ b: { c: 3 }, a: 1 }));
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(result).toEqual({ hasResponse: true, response: { ok: true } });
  });

  it("sends a text write as text/plain, byte for byte", async () => {
    const { http, calls } = makeHttp({ "POST /config/acme-demo-org/sites/acme-demo-site-eu/robots.txt": { status: 204 } });

    await sendPlannedRequest(http, { method: "POST", path: "/config/acme-demo-org/sites/acme-demo-site-eu/robots.txt", text: "User-agent: *\nDisallow: /" });

    expect(calls[0]?.headers["content-type"]).toBe("text/plain");
    expect(calls[0]?.body).toBe("User-agent: *\nDisallow: /");
  });

  it("sends a bodyless write with no body and no content type", async () => {
    const { http, calls } = makeHttp({ "POST /index/acme-demo-org/acme-demo-site-eu/main/*": { status: 202, body: { job: {} } } });

    await sendPlannedRequest(http, { method: "POST", path: "/index/acme-demo-org/acme-demo-site-eu/main/*" });

    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
  });

  it("keeps the query string of a recorded path", async () => {
    const { http, calls } = makeHttp({ [`POST ${SITE_PATH}?restoreVersion=3`]: { status: 200, body: {} } });

    await sendPlannedRequest(http, { method: "POST", path: `${SITE_PATH}?restoreVersion=3` });

    expect(new URL(calls[0]?.url ?? "").search).toBe("?restoreVersion=3");
  });

  it("rejects a GET without issuing any request", async () => {
    const { http, calls } = makeHttp({});

    await expect(sendPlannedRequest(http, { method: "GET", path: SITE_PATH } as unknown as PlannedRequest)).rejects.toThrowError(/GET/);
    expect(calls).toHaveLength(0);
  });

  it.each(["https://demo-host.example-domain/x", "//demo-host.example-domain/x", "config/relative.json", "/config/../../x"])(
    "rejects a path that could leave the Admin API's own paths (%s) without issuing any request",
    async (path) => {
      const { http, calls } = makeHttp({});

      await expect(sendPlannedRequest(http, { method: "DELETE", path })).rejects.toThrowError(/path/);
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects a request carrying both a JSON and a text body", async () => {
    const { http, calls } = makeHttp({});

    await expect(sendPlannedRequest(http, { method: "POST", path: SITE_PATH, body: {}, text: "x" } as unknown as PlannedRequest)).rejects.toThrowError(/body/);
    expect(calls).toHaveLength(0);
  });
});
