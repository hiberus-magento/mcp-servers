// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `MAGENTO_REST_GROUPS` is only usable if someone can find out which groups exist, so every group
// must be named where an operator reads: the manifest (which generates the README's Environment section), the
// README's own "Tool groups" section, and the onboarding guide. Both directions, like `manifest-env.test.ts`:
// a group added to the code without documentation fails here, and so does a documented name that is not a group.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GROUP_NAMES, allMagentoRestTools } from "./tools/index.js";

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const readme = read("../README.md");
const onboarding = read("../../../docs/magento-rest-onboarding.md");
const manifest = JSON.parse(read("../../../servers.json")) as {
  servers: ReadonlyArray<{ id: string; requires?: { env?: ReadonlyArray<{ name: string; required: boolean; description: string }> } }>;
};
const groupsVariable = manifest.servers.find((s) => s.id === "magento-rest")?.requires?.env?.find((v) => v.name === "MAGENTO_REST_GROUPS");

const section = (text: string, heading: RegExp): string => {
  const start = text.search(heading);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/\n#{1,3} /);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
};

describe("MAGENTO_REST_GROUPS is documented", () => {
  it("is declared in the manifest as optional, naming every group", () => {
    expect(groupsVariable?.required).toBe(false);
    for (const group of GROUP_NAMES) {
      expect(groupsVariable?.description, group).toContain(group);
    }
  });

  it("has a README section that lists every group, and the tools of each", () => {
    const body = section(readme, /\n## Tool groups/);
    expect(body.length).toBeGreaterThan(0);
    for (const group of GROUP_NAMES) {
      expect(body, group).toContain(`\`${group}\``);
    }
    for (const tool of allMagentoRestTools()) {
      expect(body, tool.name).toContain(tool.name.replace("magentorest_", ""));
    }
  });

  it("has an onboarding section that lists every group", () => {
    const body = section(onboarding, /\n#{2,3} [^\n]*MAGENTO_REST_GROUPS/);
    expect(body.length).toBeGreaterThan(0);
    for (const group of GROUP_NAMES) {
      expect(body, group).toContain(`\`${group}\``);
    }
  });

  it("documents no group name the server does not have", () => {
    const table = section(readme, /\n## Tool groups/);
    const documented = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual([...GROUP_NAMES].sort());
  });
});
