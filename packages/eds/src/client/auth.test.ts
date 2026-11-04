// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.21): `mintApiKey()` returns a plain object — no
// rendering — and `authStatus()` probes the documented set of read
// endpoints, returning per-probe results, never the token itself.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../testing/fetch-double.js";
import { createHttpClient } from "./http.js";
import { authStatus, deleteApiKey, listApiKeys, mintApiKey } from "./auth.js";

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

// CHANGED DELIBERATELY: the superseded case asserted a POST to
// `/config/{org}/sites/{site}/apiKeys.json` and an `expiresAt` field —
// observed live, that path answers 404 and the key records the API does
// return carry `expiration`, not `expiresAt`. Keeping it would have gone on
// proving the client agrees with a fixture nothing ever matched.
const ORG_KEYS_PATH = "/config/acme-demo-org/apiKeys.json";
const SITE_KEYS_PATH = "/config/acme-demo-org/sites/acme-demo-site-eu/apiKeys.json";

/** The fields a live key record carries (observed on `GET /config/{org}/apiKeys.json`). */
const KEY_RECORD = {
  description: "demo publishing key",
  roles: ["config_admin"],
  id: "demo-key-0001",
  subject: "demo-author@example-domain",
  expiration: "2027-01-01T00:00:00Z",
  created: "2026-10-20T00:00:00Z",
};

describe("mintApiKey", () => {
  it("posts to the ORG-level apiKeys path", async () => {
    const { http, calls } = makeHttp({ [`POST ${ORG_KEYS_PATH}`]: { status: 200, body: { ...KEY_RECORD, value: "minted-secret-once" } } });

    await mintApiKey(http, { org: "acme-demo-org", roles: ["config_admin"] });

    expect(new URL(calls[0]?.url ?? "https://admin.hlx.page/").pathname).toBe(ORG_KEYS_PATH);
  });

  // Positive control for the case above: with ONLY the old site-level route
  // registered, the call must fail. If it passed, the assertion above would
  // be proving nothing about which path is used.
  it("fails when only the old site-level path is served", async () => {
    const { http } = makeHttp({ [`POST ${SITE_KEYS_PATH}`]: { status: 200, body: { ...KEY_RECORD, value: "minted-secret-once" } } });

    const error = await mintApiKey(http, { org: "acme-demo-org", roles: ["config_admin"] }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeDefined();
    expect(String((error as Error).message)).toContain(`POST ${ORG_KEYS_PATH}`);
  });

  it("returns the declared fields only — expiration, never expiresAt, and nothing undeclared", async () => {
    const { http } = makeHttp({
      [`POST ${ORG_KEYS_PATH}`]: { status: 200, body: { ...KEY_RECORD, value: "minted-secret-once", internalNote: "undeclared" } },
    });

    const result = await mintApiKey(http, { org: "acme-demo-org", roles: ["config_admin"] });

    expect(result).toEqual({ ...KEY_RECORD, value: "minted-secret-once" });
    expect(JSON.stringify(result)).not.toContain("internalNote");
  });

  // The create response was never observed live — only the list. If it
  // carries the key value somewhere this parser does not recognise, the
  // caller must be able to see that it got nothing, not print "undefined".
  it("leaves value absent rather than inventing one when the response carries no key value", async () => {
    const { http } = makeHttp({ [`POST ${ORG_KEYS_PATH}`]: { status: 200, body: KEY_RECORD } });

    const result = await mintApiKey(http, { org: "acme-demo-org", roles: ["config_admin"] });

    expect(result.value).toBeUndefined();
    expect(result.id).toBe("demo-key-0001");
  });
});

describe("listApiKeys", () => {
  // The outer object key is the secret-shaped string the API keys its
  // records by. It is never read, so it cannot reach a caller.
  const LIST_BODY = {
    "demo-secret-shaped-outer-key": KEY_RECORD,
    "demo-second-outer-key": { ...KEY_RECORD, id: "demo-key-0002", description: "second demo key" },
  };

  it("never returns the outer object key, in any field of the serialized result", async () => {
    const { http } = makeHttp({ [`GET ${ORG_KEYS_PATH}`]: { status: 200, body: LIST_BODY } });

    const result = await listApiKeys(http, { org: "acme-demo-org" });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("demo-secret-shaped-outer-key");
    expect(serialized).not.toContain("demo-second-outer-key");
  });

  it("returns one record per key, projected field by field", async () => {
    const { http } = makeHttp({ [`GET ${ORG_KEYS_PATH}`]: { status: 200, body: LIST_BODY } });

    const result = await listApiKeys(http, { org: "acme-demo-org" });

    expect(result.map((record) => record.id)).toEqual(["demo-key-0001", "demo-key-0002"]);
    expect(result[0]).toEqual(KEY_RECORD);
  });

  it("carries no key value, even if one appears in a record", async () => {
    const { http } = makeHttp({
      [`GET ${ORG_KEYS_PATH}`]: { status: 200, body: { "demo-outer-key": { ...KEY_RECORD, value: "should-never-be-listed" } } },
    });

    const result = await listApiKeys(http, { org: "acme-demo-org" });

    expect(JSON.stringify(result)).not.toContain("should-never-be-listed");
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

  // `authStatus` is the one caller whose whole job is to report a non-ok
  // status in plain English. It must keep its verdicts now that 401/403/404
  // are thrown as named errors rather than returned as a `Response`.
  it("still reports 401, 403 and 404 verdicts per probe, not a blanket 'unknown'", async () => {
    const { http } = makeHttp({
      "GET /config/acme-demo-org.json": { status: 401 },
      "GET /config/acme-demo-org/sites.json": { status: 403 },
      "GET /status/acme-demo-org/acme-demo-site-eu/main/": { status: 404 },
    });

    const result = await authStatus(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result.probes.map((p) => p.status)).toEqual([401, 403, 404]);
    expect(result.probes.map((p) => p.verdict)).toEqual(["key rejected (401)", "key lacks the required role (403)", "org or site not found (404)"]);
  });
});

// RED-first (eds-write-surface tasks.md 2.12): delete one org-level key by
// id. CLI-only (design.md D2), so it lives here beside mint and list.
describe("deleteApiKey", () => {
  it("DELETEs the org-level key document, with the id encoded", async () => {
    const { http, calls } = makeHttp({ "DELETE /config/acme-demo-org/apiKeys/key%2Fdemo-1.json": { status: 204 } });

    await expect(deleteApiKey(http, { org: "acme-demo-org", id: "key/demo-1" })).resolves.toEqual({ hasResponse: false });
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});

// RED-first (tasks.md 2.12; eds-client spec, "API Key Metadata and
// Deletion"): `mintApiKey` is the ONLY client function that may create a
// key. A source scan, not a list of names, so a new one cannot slip in
// under a name nobody thought to forbid.
describe("key creation surface", () => {
  it("has exactly one POST to an apiKeys path in the whole client tree", () => {
    const clientDir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(clientDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".test-d.ts"));
    const creators = sources.filter((file) => /method:\s*"POST",\s*path:\s*apiKeysPath\(/.test(readFileSync(join(clientDir, file), "utf8")));

    expect(creators).toEqual(["auth.ts"]);
    expect(readFileSync(join(clientDir, "auth.ts"), "utf8").match(/method:\s*"POST"/g)).toHaveLength(1);
  });
});
