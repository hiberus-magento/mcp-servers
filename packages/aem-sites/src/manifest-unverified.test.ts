// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `servers.json`'s `unverified` field says a tool has not been exercised
// against the live service, and `gen-readme.mjs` renders it into README.md
// for a human deciding whether to install the package. The shipped tool
// description is the other half of the same claim — it is what an agent
// reads when deciding whether to CALL the tool — and the two must not
// drift apart: a README that warns while the tool description stays silent
// warns the wrong reader.
//
// Both directions are asserted, for the same reason `manifest-env.test.ts`
// asserts both: a one-way check passes just as happily when the manifest is
// the thing that went stale.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAemTools } from "./tools/aem-tools.js";

/** Must match `UNVERIFIED_MARKER` in `scripts/gen-readme.mjs`. */
const UNVERIFIED_MARKER = "Not verified against a live service";

interface ManifestTool {
  readonly name: string;
  readonly unverified?: string;
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../servers.json", import.meta.url)), "utf8")) as {
  servers: ReadonlyArray<{ id: string; tools: readonly ManifestTool[] }>;
};

const manifestTools = manifest.servers.find((server) => server.id === "aem-sites")?.tools ?? [];
const unverifiedNames = manifestTools.filter((tool) => tool.unverified !== undefined).map((tool) => tool.name);

// `getRuntime` is never called: every assertion here reads static metadata,
// and the factory resolves the runtime lazily on the first tool call.
const shippedTools = createAemTools({
  getRuntime: () => {
    throw new Error("manifest-unverified.test.ts inspects descriptions only and must never reach a handler");
  },
});

describe("servers.json's unverified tools and the shipped tool descriptions agree", () => {
  // Every aem-sites tool was run against a live author (verify-report.md), so
  // the set may be empty; the last case still catches a description that
  // claims to be unverified while servers.json is silent.

  it("names only tools the server actually ships", () => {
    const shippedNames = shippedTools.map((tool) => tool.name);
    for (const name of unverifiedNames) {
      expect(shippedNames, `servers.json marks "${name}" unverified but aem-sites ships no such tool`).toContain(name);
    }
  });

  for (const name of unverifiedNames) {
    it(`${name}: its shipped description carries the same marker README.md shows`, () => {
      const shipped = shippedTools.find((tool) => tool.name === name);
      expect(shipped?.description ?? "", `${name} is marked unverified in servers.json but its tool description is silent`).toContain(
        UNVERIFIED_MARKER,
      );
    });
  }

  it("has no tool whose description claims to be unverified while servers.json stays silent", () => {
    const claiming = shippedTools.filter((tool) => (tool.description ?? "").includes(UNVERIFIED_MARKER)).map((tool) => tool.name);
    expect(claiming.sort(), "declared unverified in the tool description but absent from servers.json").toEqual([...unverifiedNames].sort());
  });
});
