// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `scripts/manifest-env.test.mjs` proves `servers.json` NAMES the same
// variables this package's sources read. It cannot prove the `required`
// flag, because whether a variable is enforced is a runtime property, not a
// textual one. This file proves that half, by driving the real resolver
// `mcp.ts` installs: with the declared-required set present it resolves, and
// with any one of them removed it refuses.
//
// Both directions matter. "Removing it makes the server refuse" would pass
// for a manifest that marked every variable required; "the full set is
// enough" would pass for one that marked none. Together they pin the set.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeResolver } from "./tools/aco-tools.js";

interface ManifestEnvVar {
  readonly name: string;
  readonly required: boolean;
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../servers.json", import.meta.url)), "utf8")) as {
  servers: ReadonlyArray<{ id: string; requires?: { env?: readonly ManifestEnvVar[] } }>;
};

const acoEntry = manifest.servers.find((server) => server.id === "aco");
const declared = acoEntry?.requires?.env ?? [];
const requiredNames = declared.filter((entry) => entry.required).map((entry) => entry.name);

/** A value that is syntactically usable for every declared-required aco variable (all of them are base URLs). */
const SATISFYING_VALUE = "https://aco.example-domain/api";

describe("servers.json's aco required set matches what the server enforces", () => {
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

  it("resolves with exactly the declared-required set present — nothing beyond it is enforced", () => {
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
