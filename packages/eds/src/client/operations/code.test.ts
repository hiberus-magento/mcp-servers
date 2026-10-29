// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 2.10): code status, sync and delete
// on `/code/{owner}/{repo}/{ref}/{path}` — keyed by GitHub owner/repo, never
// org/site (eds-client spec, "Code Status, Sync and Delete"; "Domain-Specific
// Address Shapes").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { deleteCode, getCodeStatus, syncCode } from "./code.js";

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

const REPO = { owner: "example-owner", repo: "example-repo" };
const CODE_PATH = "/code/example-owner/example-repo/main/scripts/demo.js";

describe("code operations", () => {
  it("syncs with a bodyless POST keyed by owner and repo", async () => {
    const { http, calls } = makeHttp({ [`POST ${CODE_PATH}`]: { status: 200, body: { code: { status: 200 } } } });

    await expect(syncCode(http, { ...REPO, path: "/scripts/demo.js" })).resolves.toEqual({ hasResponse: true, response: { code: { status: 200 } } });
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.url).not.toContain("acme-demo-org");
  });

  it("deletes with a DELETE on the same address", async () => {
    const { http, calls } = makeHttp({ [`DELETE ${CODE_PATH}`]: { status: 204 } });

    await deleteCode(http, { ...REPO, path: "/scripts/demo.js" });

    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });

  it("reads the status with a GET on the requested ref", async () => {
    const { http } = makeHttp({ "GET /code/example-owner/example-repo/feature/scripts/demo.js": { status: 200, body: { code: { status: 200 } } } });

    await expect(getCodeStatus(http, { ...REPO, ref: "feature", path: "/scripts/demo.js" })).resolves.toEqual({ code: { status: 200 } });
  });
});
