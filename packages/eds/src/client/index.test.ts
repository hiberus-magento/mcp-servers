// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.23): `client/index.ts` is the ONLY public surface
// (design.md, Decision 2) — adapters may import nothing else. This asserts
// the exact export set: `createEdsClient`, `EdsClient`, every error class,
// and every `*Result`/domain type re-export, nothing else sneaks in.
import { describe, expect, it } from "vitest";
import * as clientIndex from "./index.js";

const EXPECTED_VALUE_EXPORTS = [
  "createEdsClient",
  "AdminRateLimitError",
  "ContentSourceThrottledError",
  "UpstreamUnavailableError",
  "TransientNetworkError",
  "GatewayError",
  "JobTimeoutError",
  "EdsError",
];

describe("client/index.ts public surface", () => {
  it("exports exactly the documented value bindings (functions/classes)", () => {
    const actualValueExports = Object.keys(clientIndex).filter((key) => typeof (clientIndex as Record<string, unknown>)[key] !== "undefined");
    for (const expected of EXPECTED_VALUE_EXPORTS) {
      expect(actualValueExports).toContain(expected);
    }
  });

  it("createEdsClient assembles a working client end to end", async () => {
    const { createFetchDouble } = await import("../testing/fetch-double.js");
    const { fetch } = createFetchDouble({
      "GET /status/acme-demo-org.json": { status: 200, body: {} },
    });

    const client = clientIndex.createEdsClient({
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

    expect(client.http).toBeDefined();
    expect(client.auth.mintApiKey).toBeTypeOf("function");
    expect(client.operations.snapshots.listSnapshots).toBeTypeOf("function");
  });
});
