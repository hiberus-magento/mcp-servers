// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { isEntryPoint } from "./entry-point.js";

describe("isEntryPoint", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeScript(): { dir: string; script: string } {
    const dir = mkdtempSync(join(tmpdir(), "direct-run-"));
    scratch.push(dir);
    const script = join(dir, "cli.js");
    writeFileSync(script, "");
    return { dir, script };
  }

  it("is true when the script itself is the entry point", () => {
    const { script } = makeScript();
    expect(isEntryPoint(pathToFileURL(script).href, script)).toBe(true);
  });

  it("is true when the entry point is an npm/npx bin symlink to the script", () => {
    const { dir, script } = makeScript();
    const bin = join(dir, "hiberus-demo");
    symlinkSync(script, bin);
    expect(isEntryPoint(pathToFileURL(script).href, bin)).toBe(true);
  });

  it("is false when another file is the entry point (the module was imported)", () => {
    const { dir, script } = makeScript();
    const other = join(dir, "other.js");
    writeFileSync(other, "");
    expect(isEntryPoint(pathToFileURL(script).href, other)).toBe(false);
  });

  it("is false when there is no entry point or it does not exist", () => {
    const { dir, script } = makeScript();
    expect(isEntryPoint(pathToFileURL(script).href, undefined)).toBe(false);
    expect(isEntryPoint(pathToFileURL(script).href, join(dir, "missing.js"))).toBe(false);
  });
});
