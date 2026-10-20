// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The runtime half of the manifest check — see
// `packages/aco/src/manifest-env.test.ts` for the reasoning.
//
// This server is the degenerate case: it enforces NO environment variable.
// Since `e2efb89` a missing `MAGENTO_CLOUD_CLI_TOKEN` is caught and the
// command runs anyway against the CLI's own stored session
// (`childEnvWithOptionalToken`), which
// `tools/magento-cloud-tools.test.ts`'s "passes no token in the child env
// when none is configured" already proves at the call site. What is left for
// this file is the manifest side: nothing may be marked required, because
// nothing is.
//
// The resolver itself is deliberately NOT driven here. It enforces the
// `magento-cloud` BINARY, which `requires.binaries` declares and which is
// absent from a test machine — exercising it would assert the binary
// contract, not the environment one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ManifestEnvVar {
  readonly name: string;
  readonly required: boolean;
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../servers.json", import.meta.url)), "utf8")) as {
  servers: ReadonlyArray<{ id: string; requires?: { env?: readonly ManifestEnvVar[]; binaries?: readonly string[] } }>;
};

const entry = manifest.servers.find((server) => server.id === "magento-cloud");

describe("servers.json's magento-cloud required set matches what the server enforces", () => {
  it("marks no environment variable required, because the server enforces none", () => {
    expect((entry?.requires?.env ?? []).filter((envVar) => envVar.required).map((envVar) => envVar.name)).toEqual([]);
  });

  it("still declares MAGENTO_CLOUD_CLI_TOKEN, so an optional variable is documented rather than omitted", () => {
    expect((entry?.requires?.env ?? []).map((envVar) => envVar.name)).toContain("MAGENTO_CLOUD_CLI_TOKEN");
  });

  it("declares the magento-cloud binary, which is what this server does enforce", () => {
    expect(entry?.requires?.binaries ?? []).toContain("magento-cloud");
  });
});
