// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A real `EdsClient` over the route-table `FetchDouble`, with a static token,
// for tool-level tests (eds-write-surface Phase 4). Test-only, outside
// `client/` for the same reason as `fetch-double.ts`.
import { createEdsClient, type EdsClient } from "../client/index.js";
import { createFetchDouble, type RecordedCall, type RouteTable } from "./fetch-double.js";

export const TEST_ORG = "acme-demo-org";

export interface ClientDouble {
  readonly client: EdsClient;
  readonly calls: readonly RecordedCall[];
}

export function createClientDouble(routes: RouteTable): ClientDouble {
  const { fetch, calls } = createFetchDouble(routes);
  const client = createEdsClient({
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
    org: TEST_ORG,
  });
  return { client, calls };
}

/** `"METHOD /pathname?search"` for each recorded call — the shape route keys use. */
export function callKeys(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => {
    const url = new URL(call.url);
    return `${call.method} ${url.pathname}${url.search}`;
  });
}
