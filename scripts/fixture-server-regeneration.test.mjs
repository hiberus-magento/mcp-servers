// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// CI-blocking regeneration check (tasks.md 11.7): `packages/fixture-server`
// is generated from `templates/server/` with NAME=fixture-server,
// DOMAIN=testing, BIN=fixture-server, retiring Phase 2's throwaway version
// (design.md, "The harness — packages/fixture-server"). Regenerating into a
// temp directory and diffing against the committed files byte-for-byte
// keeps "a scaffolded package passes conformance unmodified" continuously
// true instead of true once (server-manifest spec, "Template alone passes
// conformance").
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { renderTemplate } from "./template-lib.mjs";

const FIXTURE_SERVER_DIR = fileURLToPath(new URL("../packages/fixture-server", import.meta.url));

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

describe("fixture-server regeneration", () => {
  it("is byte-identical to templates/server/ rendered with NAME=fixture-server, DOMAIN=testing, BIN=fixture-server", () => {
    workDir = mkdtempSync(join(tmpdir(), "fixture-server-regen-"));
    const files = renderTemplate({
      name: "fixture-server",
      domain: "testing",
      bin: "fixture-server",
      targetDir: workDir,
    });

    expect(files.length).toBeGreaterThan(0);
    for (const relativePath of files) {
      const rendered = readFileSync(join(workDir, relativePath), "utf8");
      const committed = readFileSync(join(FIXTURE_SERVER_DIR, relativePath), "utf8");
      expect(rendered, `packages/fixture-server/${relativePath} has drifted from templates/server/`).toBe(committed);
    }
  });
});
