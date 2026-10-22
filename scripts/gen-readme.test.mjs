// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.8/11.9: `gen-readme.mjs` renders the
// glossary and sibling-repo links from `servers.json`, and `--check`
// detects a stale committed README.md by re-running the same code path in
// memory (server-manifest spec, "Generated README, No Hand Edits").
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  UNVERIFIED_MARKER,
  checkPackageReadmes,
  checkReadme,
  renderGeneratedSection,
  renderPackageSection,
  writePackageReadmes,
  writeReadme,
} from "./gen-readme.mjs";

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

  // MEASURED, not assumed: `npx -y ./hiberus-magento-eds-0.1.0.tgz` against
  // the real packed tarball exits 1 with "could not determine executable to
  // run". Every server here declares TWO bins (a CLI and an MCP server) and
  // neither is named after the package's last path segment, which is the only
  // name npx guesses — so the bare `npx -y <pkg>@<ver>` form the snippet used
  // could never start any of them. The manifest already carries the MCP
  // binary's name in `bin`; naming it explicitly after `--package` is what
  // makes the snippet copy-pasteable.
  it("names the MCP binary explicitly, because npx cannot guess it from a two-bin package", () => {
    const section = renderGeneratedSection({
      servers: [{ ...publishedServer, bin: "example-domain-mcp" }],
    });
    const snippet = JSON.parse(section.split("```json\n")[1].split("\n```")[0]);
    expect(snippet.mcpServers["example-domain-mcp"].args).toEqual([
      "-y",
      "--package",
      "@hiberus-magento/example-domain@1.2.3",
      "example-domain-mcp",
    ]);
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

// ---------------------------------------------------------------------------
// Per-package README.md — the page npm renders for a package.
//
// npm builds a package's page from the README inside its tarball, so each
// publishable package needs its own. The part of that README that rots — the
// tool list, the environment contract, the pinned install version — is
// generated from `servers.json` by the SAME code path that generates the root
// README, and `--check` covers it, for exactly the reason design.md Decision 6
// gives for the root file: a hand-maintained second copy of the manifest
// drifts the first time a tool is added.
// ---------------------------------------------------------------------------
describe("renderPackageSection", () => {
  const server = {
    id: "example-domain",
    package: "@hiberus-magento/example-domain",
    bin: "example-domain-mcp",
    version: "1.2.3",
    domain: "example",
    status: "alpha",
    description: "Synthetic example.",
    requires: {
      env: [
        { name: "EXAMPLE_TOKEN", required: true, description: "Bearer for the example API." },
        { name: "EXAMPLE_REGION", required: false, description: "Overrides the default region." },
      ],
    },
    tools: [
      { name: "noop", readOnly: true, description: "Does nothing." },
      { name: "risky", readOnly: false, description: "Changes something.", unverified: "Never run against a live service." },
    ],
  };

  it("renders the tool surface, the environment contract and a version-pinned client snippet", () => {
    const section = renderPackageSection(server);
    expect(section).toContain("`noop` (read-only) — Does nothing.");
    expect(section).toContain("`EXAMPLE_TOKEN` (required) — Bearer for the example API.");
    expect(section).toContain("`EXAMPLE_REGION` (optional) — Overrides the default region.");
    expect(section).toContain("@hiberus-magento/example-domain@1.2.3");
    expect(section).toContain("${EXAMPLE_TOKEN}");
    // Same reason as the root README: an MCP client handed `${VAR}` for a
    // variable the operator never set commonly forwards the literal text.
    expect(section).not.toContain("${EXAMPLE_REGION}");
  });

  it("carries the same unverified wording the manifest and the root README use", () => {
    const section = renderPackageSection(server);
    expect(section).toContain(`\`risky\` — Changes something. **${UNVERIFIED_MARKER}** — Never run against a live service.`);
  });
});

describe("checkPackageReadmes / writePackageReadmes", () => {
  const PACKAGE_SKELETON = "# @hiberus-magento/example-domain\n\nHand-written prose.\n\n<!-- package:start -->\n<!-- package:end -->\n\n## License\n";

  const manifest = {
    servers: [
      {
        id: "example-domain",
        package: "@hiberus-magento/example-domain",
        bin: "example-domain-mcp",
        version: "1.2.3",
        domain: "example",
        status: "alpha",
        description: "Synthetic example.",
        tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
      },
    ],
  };

  function setupPackages(current) {
    workDir = mkdtempSync(join(tmpdir(), "gen-readme-pkg-test-"));
    const packagesDir = join(workDir, "packages");
    const manifestPath = join(workDir, "servers.json");
    writeFileSync(manifestPath, JSON.stringify(current), "utf8");
    for (const server of current.servers) {
      mkdirSync(join(packagesDir, server.id), { recursive: true });
      writeFileSync(join(packagesDir, server.id, "README.md"), PACKAGE_SKELETON, "utf8");
    }
    return { packagesDir, manifestPath };
  }

  it("reports nothing stale immediately after writePackageReadmes", () => {
    const { packagesDir, manifestPath } = setupPackages(manifest);
    writePackageReadmes({ packagesDir, manifestPath });
    expect(checkPackageReadmes({ packagesDir, manifestPath }).stale).toEqual([]);
  });

  it("names the package whose README no longer matches the manifest", () => {
    const { packagesDir, manifestPath } = setupPackages(manifest);
    writePackageReadmes({ packagesDir, manifestPath });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        servers: [
          { ...manifest.servers[0], tools: [{ name: "added-later", readOnly: true, description: "A tool nobody regenerated for." }] },
        ],
      }),
      "utf8",
    );
    expect(checkPackageReadmes({ packagesDir, manifestPath }).stale).toEqual(["example-domain"]);
  });

  // A publishable package with no README at all is the defect that started
  // this: three packages shipped and every npm page read "This package does
  // not have a README". Absence has to fail the check, not be skipped.
  it("reports a manifest server that has no README.md at all", () => {
    const { packagesDir, manifestPath } = setupPackages(manifest);
    rmSync(join(packagesDir, "example-domain", "README.md"));
    expect(checkPackageReadmes({ packagesDir, manifestPath }).missing).toEqual(["example-domain"]);
  });
});
