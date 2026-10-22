// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.8/11.9: `gen-readme.mjs` renders the
// servers index from `servers.json`, and `--check` detects a stale
// committed README.md by re-running the same code path in memory
// (server-manifest spec, "Generated README, No Hand Edits").
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("keeps an optional variable out of the consumer snippet", () => {
    const section = renderGeneratedSection({ servers: [publishedServer] });
    // An unset `${EXAMPLE_REGION}` is commonly forwarded literally by an MCP
    // client, so it must not appear in the snippet at all. The root README no
    // longer documents the variable itself — `renderPackageSection` does.
    expect(section).not.toContain("${EXAMPLE_REGION}");
  });

  // The root README is a front door, not a manual. Three package READMEs now
  // carry the per-tool list, the environment contract and a per-server
  // snippet, so repeating them here made the root page a duplicate of three
  // documents — and the duplicate is the copy that goes stale, because it is
  // the one nobody opens when they change a tool.
  it("routes to each package instead of repeating its tool list and environment contract", () => {
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
    expect(section).not.toContain("`noop`");
    expect(section).not.toContain("`risky`");
    expect(section).not.toContain(UNVERIFIED_MARKER);
    expect(section).not.toContain("`EXAMPLE_TOKEN` (required)");
    expect(section).not.toContain("`EXAMPLE_REGION` (optional)");
    expect(section).toContain("./packages/example-domain/README.md");
  });

  // One row per server, generated, so a server added to `servers.json` cannot
  // be missing from the front page — which is the single thing the root README
  // still has to be right about.
  it("renders one table row per server carrying its purpose, npm page and README", () => {
    const section = renderGeneratedSection({ servers: [publishedServer] });
    const rows = section.split("\n").filter((line) => line.startsWith("| [") || line.startsWith("| `"));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toContain("[`@hiberus-magento/example-domain`](https://npmjs.com/package/@hiberus-magento/example-domain)");
    expect(row).toContain("Synthetic example.");
    expect(row).toContain("[README](./packages/example-domain/README.md)");
    expect(row).toContain("1.2.3");
  });

  it("links a server's `docs` entry when the manifest carries one, and omits the link when it does not", () => {
    const withDocs = renderGeneratedSection({ servers: [{ ...publishedServer, docs: "docs/example-onboarding.md" }] });
    expect(withDocs).toContain("(./docs/example-onboarding.md)");
    const withoutDocs = renderGeneratedSection({ servers: [publishedServer] });
    expect(withoutDocs).not.toContain("example-onboarding");
  });

  // A `|` inside a manifest description would otherwise be read as a column
  // break and silently shear the row apart. No current description contains
  // one; the next one written might.
  it("escapes a pipe in a description so it cannot break the table apart", () => {
    const section = renderGeneratedSection({
      servers: [{ ...publishedServer, description: "Reads a | writes b." }],
    });
    expect(section).toContain("Reads a \\| writes b.");
  });

  // `planned` and `internal` servers have no npm page to link to: `internal`
  // is never published at all, and `planned` is not built yet. Linking either
  // would put a 404 on the front page.
  it("does not link an unpublished server to a package page that does not exist", () => {
    const section = renderGeneratedSection({ servers: [{ ...publishedServer, status: "planned" }] });
    expect(section).not.toContain("https://npmjs.com/package/@hiberus-magento/example-domain");
    expect(section).toContain("`@hiberus-magento/example-domain`");
  });

  it("says so plainly when the manifest declares no servers at all", () => {
    expect(renderGeneratedSection({ servers: [] })).toContain("_No servers are published yet._");
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

  it("carries the same unverified wording the manifest uses", () => {
    const section = renderPackageSection(server);
    expect(section).toContain(`\`risky\` — Changes something. **${UNVERIFIED_MARKER}** — Never run against a live service.`);
  });

  it("leaves a tool with no `unverified` field unmarked, so absence records no claim either way", () => {
    const section = renderPackageSection({ ...server, tools: [server.tools[0]] });
    expect(section).toContain("`noop` (read-only) — Does nothing.");
    expect(section).not.toContain(UNVERIFIED_MARKER);
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

// ---------------------------------------------------------------------------
// The committed artifacts, not just the renderers.
//
// The glossary and the sibling-repository links used to be string constants
// inside gen-readme.mjs, spliced into the generated region. Nothing in
// `servers.json` fed either of them, so "generated" only meant "edit this
// prose in a .mjs file, and silently lose any edit made in README.md where a
// writer would actually make it". They are hand-written prose in README.md
// now — which means the assertion that they still exist has to look at
// README.md. That is a stronger check than the one it replaces: it reads the
// artifact a reader gets, not a constant the generator happens to hold.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("the committed root README", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

  it("still defines all three of EDS, ACS and ACO — the acronyms this domain confuses", () => {
    expect(readme).toContain("**EDS**");
    expect(readme).toContain("**ACS**");
    expect(readme).toContain("**ACO**");
    expect(readme).toContain("Edge Delivery Services");
    expect(readme).toContain("Adobe Commerce Storefront");
    expect(readme).toContain("Adobe Commerce Optimizer");
  });

  it("still links both sibling repositories", () => {
    expect(readme).toContain("hiberus-magento/ai-tools");
    expect(readme).toContain("hiberus-magento/hiberus-dockergento");
  });

  // The page a new teammate needs. A front door that does not route to it is
  // not doing its one job.
  it("links the team setup guide", () => {
    expect(readme).toContain("docs/team-setup.md");
    expect(existsSync(join(REPO_ROOT, "docs", "team-setup.md"))).toBe(true);
  });

  // Every relative link the front page makes is a routing promise, and the
  // front page is now almost entirely links. A broken one sends a stranger to
  // a 404 on their first click.
  it("points every relative link at a file that exists", () => {
    const targets = [...readme.matchAll(/\]\(\.\/([^)#]+)/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !existsSync(join(REPO_ROOT, target)))).toEqual([]);
  });
});

// `renderPackageSection` and the root README share `renderConsumerConfigSnippet`,
// so a change made for one can silently rewrite the other. Running the real
// check against the real committed files is what catches that: if either
// renderer moved, one of these two stops being byte-identical to what the
// code produces, without anyone having to notice.
describe("the committed files are byte-identical to what this generator renders", () => {
  it("leaves the root README unchanged", () => {
    expect(checkReadme().stale).toBe(false);
  });

  it("leaves every package README unchanged, and none missing", () => {
    expect(checkPackageReadmes()).toEqual({ stale: [], missing: [] });
  });
});
