// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.4): `ListChannels` is a named admin query
// (exploration.md, `Q_VIEWS`). The response fixture (tasks.md 2.20) lives in
// `packages/aco/fixtures/channels.json`, synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listChannels } from "./channels.js";

const CHANNELS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/channels.json", import.meta.url)), "utf8")) as {
  readonly channels: readonly {
    readonly channelId: string;
    readonly name: string;
    readonly scopes: readonly { readonly locale: string }[];
    readonly defaultPriceBookId: string;
    readonly policyIds: readonly string[];
    readonly protectionEnabled: boolean;
  }[];
};

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

describe("listChannels", () => {
  it("issues the named ListChannels query and flattens scopes into locales", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListChannels": graphQlOk(CHANNELS_FIXTURE),
    });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/admin/graphql",
      tokenProvider: stubTokenProvider(),
    });

    const result = await listChannels(transport);

    const expected = CHANNELS_FIXTURE.channels[0] as (typeof CHANNELS_FIXTURE.channels)[number];
    expect(result.views).toEqual([
      {
        channelId: expected.channelId,
        name: expected.name,
        locales: expected.scopes.map((scope) => scope.locale),
        defaultPriceBookId: expected.defaultPriceBookId,
        policyIds: expected.policyIds,
        protectionEnabled: expected.protectionEnabled,
      },
    ]);
    expect(calls[0]?.operationName).toBe("ListChannels");
  });
});
