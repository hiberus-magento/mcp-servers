// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.8/11.9: `gen-readme.mjs` renders the
// glossary and sibling-repo links from `servers.json`, and `--check`
// detects a stale committed README.md by re-running the same code path in
// memory (server-manifest spec, "Generated README, No Hand Edits").
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkReadme, renderGeneratedSection, writeReadme } from "./gen-readme.mjs";

const SKELETON = `# mcp-servers\n\nTest fixture skeleton.\n\n<!-- servers:start -->\n<!-- servers:end -->\n\n## License\n`;

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

function setup(manifest) {
  workDir = mkdtempSync(join(tmpdir(), "gen-readme-test-"));
  const readmePath = join(workDir, "README.md");
  const manifestPath = join(workDir, "servers.json");
  writeFileSync(readmePath, SKELETON, "utf8");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return { readmePath, manifestPath };
}

describe("renderGeneratedSection", () => {
  it("includes the EDS/ACS/ACO glossary and both sibling-repository links", () => {
    const section = renderGeneratedSection({ servers: [] });
    expect(section).toContain("EDS");
    expect(section).toContain("ACS");
    expect(section).toContain("ACO");
    expect(section).toContain("hiberus-magento/ai-tools");
    expect(section).toContain("hiberus-magento/hiberus-dockergento");
  });

  it("pins an exact version and uses ${VAR} secret references for a published server", () => {
    const section = renderGeneratedSection({
      servers: [
        {
          id: "example-domain",
          package: "@hiberus-magento/example-domain",
          bin: "example-domain",
          version: "1.2.3",
          domain: "example",
          status: "published",
          description: "Synthetic example.",
          requires: { env: ["EXAMPLE_TOKEN"] },
          tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
        },
      ],
    });
    expect(section).toContain("@hiberus-magento/example-domain@1.2.3");
    expect(section).toContain("${EXAMPLE_TOKEN}");
    expect(section).not.toMatch(/EXAMPLE_TOKEN"\s*:\s*"(?!\$\{)/);
  });
});

describe("checkReadme / writeReadme", () => {
  it("reports not stale immediately after writeReadme", () => {
    const { readmePath, manifestPath } = setup({ servers: [] });
    writeReadme({ readmePath, manifestPath });
    const result = checkReadme({ readmePath, manifestPath });
    expect(result.stale).toBe(false);
  });

  it("reports stale when servers.json changes after the README was generated", () => {
    const { readmePath, manifestPath } = setup({ servers: [] });
    writeReadme({ readmePath, manifestPath });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        servers: [
          {
            id: "example-domain",
            package: "@hiberus-magento/example-domain",
            bin: "example-domain",
            version: "1.2.3",
            domain: "example",
            status: "published",
            description: "Synthetic example.",
            tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
          },
        ],
      }),
      "utf8",
    );
    const result = checkReadme({ readmePath, manifestPath });
    expect(result.stale).toBe(true);
  });
});
