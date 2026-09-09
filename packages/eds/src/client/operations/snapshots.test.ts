// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.13): a snapshot-creating POST must always carry an
// explicit, non-empty JSON body with a content-type header — an empty body
// is inferred only to mean "add everything" and is never relied upon
// (eds-client spec, "Explicit JSON Body on Snapshot Writes").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { addToSnapshot, listSnapshots } from "./snapshots.js";

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

describe("addToSnapshot", () => {
  it("always sends a non-empty JSON body with a content-type header when paths are supplied", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026";
    const { http, calls } = makeHttp({ [`POST ${path}`]: { status: 200, body: { snapshot: { id: "launch-2026" } } } });

    await addToSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026", paths: ["/index.html"] });

    expect(calls[0]?.body).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/index.html"] });
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
  });

  it("still sends an explicit, non-empty JSON body when the caller supplies no paths (never a bodyless POST)", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026";
    const { http, calls } = makeHttp({ [`POST ${path}`]: { status: 200, body: { snapshot: { id: "launch-2026" } } } });

    await addToSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" });

    expect(calls[0]?.body).toBeTruthy();
    expect(calls[0]?.body).not.toBe("");
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: [] });
  });
});

describe("listSnapshots", () => {
  it("lists snapshots pinned to main", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main";
    const { http } = makeHttp({ [`GET ${path}`]: { status: 200, body: [{ id: "launch-2026" }] } });

    const result = await listSnapshots(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result).toEqual([{ id: "launch-2026" }]);
  });
});
