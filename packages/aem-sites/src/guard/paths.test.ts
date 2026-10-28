// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import {
  assertAemPath,
  assertWritable,
  InvalidAemPathError,
  InvalidPathPatternError,
  InvalidWriteRootError,
  parsePathPatterns,
  parseWriteRoots,
  PathOutsideWriteRootsError,
  protectedPatternFor,
  InvalidRolloutConfigError,
  parseRolloutConfigs,
} from "./paths.js";

const ROOT = "/content/acme-demo-site-eu";

describe("assertAemPath", () => {
  it("accepts a plain page path", () => {
    expect(assertAemPath(`${ROOT}/en/outdoor-gear`)).toBe(`${ROOT}/en/outdoor-gear`);
  });

  const rejected = [
    "",
    "/",
    "content/acme-demo-site-eu",
    `${ROOT}/`,
    `${ROOT}//en`,
    `${ROOT}/../acme-demo-site-us`,
    `${ROOT}/./en`,
    `${ROOT}/en.html`,
    `${ROOT}/en.infinity.json`,
    `${ROOT}/jcr:content`,
    `${ROOT}%2F..%2Facme-demo-site-us`,
    `${ROOT}/en?x=1`,
    `${ROOT}/en#x`,
    `${ROOT}/en x`,
    `${ROOT}\\en`,
    `${ROOT}/en\n`,
  ];
  for (const path of rejected) {
    it(`rejects ${JSON.stringify(path)}`, () => {
      expect(() => assertAemPath(path)).toThrow(InvalidAemPathError);
    });
  }

  it("rejects every path containing a character outside the grammar (generated)", () => {
    const outside = [".", "%", "?", "#", ":", ";", "@", " ", "\\", "~", "*", "\u0000", "é"];
    for (const ch of outside) {
      expect(() => assertAemPath(`${ROOT}/a${ch}b`), JSON.stringify(ch)).toThrow(InvalidAemPathError);
    }
  });
});

describe("parseWriteRoots", () => {
  it("returns no roots when unset or blank", () => {
    expect(parseWriteRoots(undefined)).toEqual([]);
    expect(parseWriteRoots("  ")).toEqual([]);
  });

  it("splits, trims and de-duplicates", () => {
    expect(parseWriteRoots(` ${ROOT} ,/content/acme-demo-site-us,${ROOT}`)).toEqual([ROOT, "/content/acme-demo-site-us"]);
  });

  for (const root of ["/content", "/apps/acme", "/libs", "/conf/acme", "/home/users", "/var/x", "/etc/x", "/content/dam", "/content/dam/acme", "/content/a.b"]) {
    it(`refuses ${root}`, () => {
      expect(() => parseWriteRoots(root)).toThrow(InvalidWriteRootError);
    });
  }
});

describe("assertWritable", () => {
  it("accepts the root itself and any descendant", () => {
    expect(assertWritable(ROOT, [ROOT])).toBe(ROOT);
    expect(assertWritable(`${ROOT}/en/a`, [ROOT])).toBe(`${ROOT}/en/a`);
  });

  it("rejects a sibling that shares the root as a string prefix", () => {
    expect(() => assertWritable(`${ROOT}-other/en`, [ROOT])).toThrow(PathOutsideWriteRootsError);
  });

  it("rejects everything when no root is configured, naming the variable", () => {
    expect(() => assertWritable(`${ROOT}/en`, [])).toThrow(/AEM_WRITE_ROOTS/);
  });

  it("rejects traversal before checking roots", () => {
    expect(() => assertWritable(`${ROOT}/../acme-demo-site-us/en`, [ROOT])).toThrow(InvalidAemPathError);
  });
});

describe("protected path patterns", () => {
  const patterns = parsePathPatterns("/content/*/en/internal, /content/acme-demo-site-us");

  it("matches the pattern itself and every descendant", () => {
    expect(protectedPatternFor(`${ROOT}/en/internal`, patterns)).toBe("/content/*/en/internal");
    expect(protectedPatternFor(`${ROOT}/en/internal/draft`, patterns)).toBe("/content/*/en/internal");
    expect(protectedPatternFor("/content/acme-demo-site-us/fr", patterns)).toBe("/content/acme-demo-site-us");
  });

  it("does not match an ancestor of the pattern, a sibling or a partial segment", () => {
    expect(protectedPatternFor(`${ROOT}/en`, patterns)).toBeUndefined();
    expect(protectedPatternFor(`${ROOT}/en/internals`, patterns)).toBeUndefined();
    expect(protectedPatternFor("/content/acme-demo-site-usa", patterns)).toBeUndefined();
  });

  it("refuses a pattern with a partial wildcard or a dot", () => {
    expect(() => parsePathPatterns("/content/acme*")).toThrow(InvalidPathPatternError);
    expect(() => parsePathPatterns("/content/a.b")).toThrow(InvalidPathPatternError);
  });
});

describe("rollout configs", () => {
  it("parses project configs under /apps/msm or /conf only", () => {
    expect(parseRolloutConfigs(" /apps/msm/acme/sync, /conf/acme/msm/x ")).toEqual(["/apps/msm/acme/sync", "/conf/acme/msm/x"]);
    expect(() => parseRolloutConfigs("/apps/acme/sync")).toThrow(InvalidRolloutConfigError);
    expect(() => parseRolloutConfigs("/content/x")).toThrow(InvalidRolloutConfigError);
  });
});
