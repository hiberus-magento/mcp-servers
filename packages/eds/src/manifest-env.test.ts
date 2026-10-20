// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The runtime half of the manifest check — see
// `packages/aco/src/manifest-env.test.ts` for why the textual scan in
// `scripts/manifest-env.test.mjs` cannot cover the `required` flag on its
// own, and why both directions are asserted.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeResolver } from "./tools/eds-tools.js";

interface ManifestEnvVar {
  readonly name: string;
  readonly required: boolean;
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../servers.json", import.meta.url)), "utf8")) as {
  servers: ReadonlyArray<{ id: string; requires?: { env?: readonly ManifestEnvVar[] } }>;
};

const declared = manifest.servers.find((server) => server.id === "eds")?.requires?.env ?? [];
const requiredNames = declared.filter((entry) => entry.required).map((entry) => entry.name);

/** Usable for every declared-required eds variable (`EDS_ORG` is an org slug). */
const SATISFYING_VALUE = "example-org";

describe("servers.json's eds required set matches what the server enforces", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(declared.map((entry) => [entry.name, process.env[entry.name]]));
    for (const entry of declared) {
      delete process.env[entry.name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("declares at least one required variable, so the cases below are not vacuous", () => {
    expect(requiredNames.length).toBeGreaterThan(0);
  });

  it("resolves with exactly the declared-required set present — in particular EDS_TOKEN is not enforced here", () => {
    for (const name of requiredNames) {
      process.env[name] = SATISFYING_VALUE;
    }
    expect(() => createRuntimeResolver()()).not.toThrow();
  });

  for (const missing of requiredNames) {
    it(`refuses when ${missing} alone is absent`, () => {
      for (const name of requiredNames) {
        process.env[name] = SATISFYING_VALUE;
      }
      delete process.env[missing];
      expect(() => createRuntimeResolver()()).toThrow(missing);
    });
  }
});
