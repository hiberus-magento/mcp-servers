// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `servers.json` is published into README.md and the docs, and the
// conformance suite does not compare it to what the server actually serves, so
// nothing else stops the two drifting. This does: the tool names and each
// tool's `readOnly` flag in the manifest must equal the registered tools and
// their annotations. A manifest that calls a write tool read-only would tell
// an operator it is safe to leave unattended.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allMagentoGraphqlTools } from "./tools/index.js";
import { LIVE_VERIFIED_TOOLS, UNVERIFIED_DETAIL, UNVERIFIED_MARKER } from "./tools/verification.js";

interface ManifestTool {
  readonly name: string;
  readonly readOnly: boolean;
  readonly description: string;
  readonly unverified?: string;
}
interface ManifestServer {
  readonly id: string;
  readonly package: string;
  readonly bin: string;
  readonly version: string;
  readonly domain: string;
  readonly status: string;
  readonly tools: readonly ManifestTool[];
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../servers.json", import.meta.url)), "utf8")) as { servers: readonly ManifestServer[] };
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { name: string; version: string; bin: Record<string, string> };
const entry = manifest.servers.find((server) => server.id === "magento-graphql");
const registered = allMagentoGraphqlTools();

describe("servers.json's magento-graphql entry matches the package", () => {
  it("exists and agrees with package.json on name, version and MCP bin", () => {
    expect(entry, "no magento-graphql entry in servers.json").toBeDefined();
    expect(entry?.package).toBe(pkg.name);
    expect(entry?.version).toBe(pkg.version);
    expect(entry?.domain).toBe("magento-graphql");
    expect(Object.keys(pkg.bin)).toContain(entry?.bin);
  });

  it("lists exactly the registered tools — no stale scaffold names, none missing", () => {
    expect((entry?.tools ?? []).map((t) => t.name).sort()).toEqual(registered.map((t) => t.name).sort());
  });

  it("marks a tool readOnly exactly when its readOnlyHint says so", () => {
    for (const tool of registered) {
      const listed = entry?.tools.find((t) => t.name === tool.name);
      expect(listed?.readOnly, tool.name).toBe(tool.annotations.readOnlyHint);
    }
  });

  it("describes each tool with the text the server sends, minus the verification note", () => {
    for (const tool of registered) {
      const listed = entry?.tools.find((t) => t.name === tool.name);
      expect(tool.description.startsWith(listed?.description ?? "\u0000"), tool.name).toBe(true);
    }
  });
});

// Both directions, for the same reason `manifest-env.test.ts` asserts both: a
// one-way check passes just as happily when the manifest is what went stale.
// The README warns the human choosing to install; the shipped description
// warns the agent choosing to call. They must say the same thing.
describe("servers.json's unverified marking and the shipped descriptions agree", () => {
  it("marks a tool unverified exactly when it is not on the live-verified list", () => {
    for (const tool of registered) {
      const listed = entry?.tools.find((t) => t.name === tool.name);
      expect(listed?.unverified !== undefined, tool.name).toBe(!LIVE_VERIFIED_TOOLS.has(tool.name));
    }
  });

  it("carries the marker in the shipped description exactly when servers.json carries `unverified`", () => {
    for (const tool of registered) {
      const listed = entry?.tools.find((t) => t.name === tool.name);
      expect(tool.description.includes(UNVERIFIED_MARKER), tool.name).toBe(listed?.unverified !== undefined);
    }
  });

  it("uses the shared wording in the manifest", () => {
    for (const tool of entry?.tools ?? []) {
      if (tool.unverified !== undefined) {
        expect(tool.unverified, tool.name).toBe(UNVERIFIED_DETAIL);
      }
    }
  });

  it("lists only real tools as live-verified", () => {
    const names = registered.map((t) => t.name);
    for (const verified of LIVE_VERIFIED_TOOLS) {
      expect(names).toContain(verified);
    }
  });
});
