// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.3): `ListScopes` is a named admin query
// (exploration.md, `Q_SOURCES` — `{ scopes { locale } }`). The response
// fixture (tasks.md 2.20) lives in `packages/aco/fixtures/scopes.json`,
// synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listScopes } from "./scopes.js";

const SCOPES_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/scopes.json", import.meta.url)), "utf8")) as { readonly scopes: readonly { readonly locale: string }[] };

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

function stubTokenProvider() {
  return {
    domain: "aco",
    getToken: async () => ({ kind: "static" as const, value: "test-only-bearer" }),
    invalidate: () => undefined,
    describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: "ACO_TOKEN", configPath: "/dev/null", reason: "not found" }),
  };
}

describe("listScopes", () => {
  it("issues the named ListScopes query and returns the configured locales", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListScopes": graphQlOk(SCOPES_FIXTURE),
    });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/admin/graphql",
      tokenProvider: stubTokenProvider(),
    });

    const result = await listScopes(transport);

    expect(result.scopes).toEqual(SCOPES_FIXTURE.scopes);
    expect(calls[0]?.operationName).toBe("ListScopes");
  });
});
