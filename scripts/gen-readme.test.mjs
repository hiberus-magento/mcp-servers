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
import { UNVERIFIED_MARKER, checkReadme, renderGeneratedSection, writeReadme } from "./gen-readme.mjs";

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

  // CHANGED DELIBERATELY: `requires.env` entries carry `required`/`description`
  // since the manifest stopped flattening required and optional into one list.
  const publishedServer = {
    id: "example-domain",
    package: "@hiberus-magento/example-domain",
    bin: "example-domain",
    version: "1.2.3",
    domain: "example",
    status: "published",
    description: "Synthetic example.",
    requires: {
      env: [
        { name: "EXAMPLE_TOKEN", required: true, description: "Bearer for the example API." },
        { name: "EXAMPLE_REGION", required: false, description: "Overrides the default region." },
      ],
    },
    tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
  };

  it("pins an exact version and uses ${VAR} secret references for a published server", () => {
    const section = renderGeneratedSection({ servers: [publishedServer] });
    expect(section).toContain("@hiberus-magento/example-domain@1.2.3");
    expect(section).toContain("${EXAMPLE_TOKEN}");
    expect(section).not.toMatch(/EXAMPLE_TOKEN"\s*:\s*"(?!\$\{)/);
  });

  it("keeps an optional variable out of the consumer snippet but documents it", () => {
    const section = renderGeneratedSection({ servers: [publishedServer] });
    // An unset `${EXAMPLE_REGION}` is commonly forwarded literally by an MCP
    // client, so it must not appear in the snippet at all.
    expect(section).not.toContain("${EXAMPLE_REGION}");
    expect(section).toContain("`EXAMPLE_REGION` (optional) — Overrides the default region.");
    expect(section).toContain("`EXAMPLE_TOKEN` (required) — Bearer for the example API.");
  });

  // A reader choosing whether to install is the one who needs to know a tool
  // has never met the real service, so the marker belongs beside the tool in
  // the generated README and not only in an onboarding doc.
  it("marks a tool carrying `unverified` and says what was not exercised", () => {
    const section = renderGeneratedSection({
      servers: [
        {
          ...publishedServer,
          tools: [
            { name: "noop", readOnly: true, description: "Does nothing." },
            { name: "risky", readOnly: false, description: "Changes something.", unverified: "Never run against a live service." },
          ],
        },
      ],
    });
    expect(section).toContain(`\`risky\` — Changes something. **${UNVERIFIED_MARKER}** — Never run against a live service.`);
  });

  it("leaves a tool with no `unverified` field unmarked, so absence records no claim either way", () => {
    const section = renderGeneratedSection({ servers: [publishedServer] });
    expect(section).toContain("`noop` (read-only) — Does nothing.");
    expect(section).not.toContain(UNVERIFIED_MARKER);
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
