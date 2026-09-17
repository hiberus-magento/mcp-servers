// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `locateBinary` (design.md, Decision 2; tasks.md 2.1-2.3) walks an
// INJECTED `pathEntries: readonly string[]` — never `process.env.PATH`,
// keeping `client/` pure (magento-cloud-client spec, "Client Module
// Purity"). This is what lets `CommandSpec.bin`'s own contract
// ("Resolved absolute at registration time") be satisfied entirely
// pre-spawn, closing `run-allowlisted.ts:43`'s `ENOENT` trap (design.md,
// Decision 2) without any `mcp-core` change.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locateBinary } from "./locate-binary.js";

const FAKE_BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin");

describe("locateBinary", () => {
  it("returns none when no candidate directory contains an executable binary", () => {
    const result = locateBinary({ binaryName: "magento-cloud", pathEntries: ["/nonexistent/dir-one", "/nonexistent/dir-two"] });

    expect(result).toBeUndefined();
  });

  it("resolves the fake binary's absolute path when pathEntries points at test/fake-bin (real process)", () => {
    const result = locateBinary({ binaryName: "magento-cloud", pathEntries: [FAKE_BIN_DIR] });

    expect(result).toBe(join(FAKE_BIN_DIR, "magento-cloud"));
  });

  it("skips a non-executable candidate and keeps searching later pathEntries", () => {
    // This file itself is a real, non-executable regular file at a known
    // path, standing in for "a candidate exists but fails accessSync(X_OK)"
    // — proving the check is genuinely X_OK, not merely existsSync.
    const thisFileDir = dirname(fileURLToPath(import.meta.url));
    const result = locateBinary({
      binaryName: "locate-binary.test.ts",
      pathEntries: [thisFileDir],
    });

    // A regular, non-executable `.ts` source file must NOT resolve, even
    // though it exists at that exact path.
    expect(result).toBeUndefined();
  });
});
