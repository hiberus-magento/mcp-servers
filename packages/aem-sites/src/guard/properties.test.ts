// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import {
  assertPropertyValue,
  assertRobotsTokens,
  assertSheetColumn,
  assertWritableProperty,
  BUILTIN_PAGE_PROPERTIES,
  ForbiddenPropertyNameError,
  InvalidExtraPropertyError,
  InvalidPropertyValueError,
  parseExtraProperties,
} from "./properties.js";

describe("assertWritableProperty", () => {
  for (const name of BUILTIN_PAGE_PROPERTIES) {
    it(`accepts the built-in ${name}`, () => {
      expect(assertWritableProperty(name, [])).toBe(name);
    });
  }

  it("accepts a configured extra property", () => {
    expect(assertWritableProperty("acmeTeaser", ["acmeTeaser"])).toBe("acmeTeaser");
  });

  it("refuses an unlisted property", () => {
    expect(() => assertWritableProperty("acmeTeaser", [])).toThrow(/AEM_EXTRA_PROPERTIES/);
  });

  const operators = [
    "jcr:title@MoveFrom",
    "jcr:title@CopyFrom",
    "jcr:title@Delete",
    "jcr:title@TypeHint",
    "@x",
    ":operation",
    ":redirect",
    ":nameHint",
  ];
  for (const name of operators) {
    it(`refuses the Sling operator ${name}, even when configured`, () => {
      expect(() => assertWritableProperty(name, [name])).toThrow(ForbiddenPropertyNameError);
    });
  }

  for (const name of ["jcr:primaryType", "jcr:mixinTypes", "sling:resourceType", "cq:template", "rep:policy", "cq:lastReplicated", "cq:lastModified", "jcr:lockOwner"]) {
    it(`refuses the structural property ${name}, even when configured`, () => {
      expect(() => assertWritableProperty(name, [name])).toThrow(ForbiddenPropertyNameError);
    });
  }

  it("refuses every name containing @ or starting with : (generated)", () => {
    for (const base of BUILTIN_PAGE_PROPERTIES) {
      for (const suffix of ["@MoveFrom", "@CopyFrom", "@Delete", "@TypeHint", "@DefaultValue", "@UseDefaultWhenMissing", "@IgnoreBlanks", "@Patch"]) {
        expect(() => assertWritableProperty(`${base}${suffix}`, [`${base}${suffix}`])).toThrow(ForbiddenPropertyNameError);
      }
      expect(() => assertWritableProperty(`:${base}`, [`:${base}`])).toThrow(ForbiddenPropertyNameError);
    }
  });
});

describe("parseExtraProperties", () => {
  it("parses exact names", () => {
    expect(parseExtraProperties(" acmeTeaser, acme:badge ,acmeTeaser")).toEqual(["acmeTeaser", "acme:badge"]);
  });

  for (const name of ["sling:resourceType", "x@MoveFrom", ":operation", "rep:glob", "a*", "a.b"]) {
    it(`refuses ${name}`, () => {
      expect(() => parseExtraProperties(name)).toThrow(InvalidExtraPropertyError);
    });
  }
});

describe("assertPropertyValue", () => {
  it("accepts strings, booleans, finite numbers and string lists", () => {
    expect(assertPropertyValue("a", "x")).toBe("x");
    expect(assertPropertyValue("a", true)).toBe(true);
    expect(assertPropertyValue("a", 3)).toBe(3);
    expect(assertPropertyValue("a", ["x", "y"])).toEqual(["x", "y"]);
  });

  for (const value of [null, undefined, {}, [1], Number.NaN, Number.POSITIVE_INFINITY, "x".repeat(10_001), Array.from({ length: 101 }, () => "x")]) {
    it(`refuses ${JSON.stringify(value)?.slice(0, 40)}`, () => {
      expect(() => assertPropertyValue("a", value)).toThrow(InvalidPropertyValueError);
    });
  }
});

describe("assertRobotsTokens", () => {
  it("de-duplicates allowed tokens", () => {
    expect(assertRobotsTokens(["noindex", "nofollow", "noindex"])).toEqual(["noindex", "nofollow"]);
  });

  it("refuses an empty list and unknown tokens", () => {
    expect(() => assertRobotsTokens([])).toThrow(InvalidPropertyValueError);
    expect(() => assertRobotsTokens(["noindex", "none"])).toThrow(InvalidPropertyValueError);
  });
});

describe("assertSheetColumn", () => {
  it("accepts plain column names", () => {
    expect(assertSheetColumn("URL")).toBe("URL");
    expect(assertSheetColumn("Robots")).toBe("Robots");
    expect(assertSheetColumn("og image")).toBe("og image");
  });

  for (const name of ["", "1a", "a@Delete", ":operation", "jcr:primaryType", "a/b", "a.b"]) {
    it(`refuses ${JSON.stringify(name)}`, () => {
      expect(() => assertSheetColumn(name)).toThrow(ForbiddenPropertyNameError);
    });
  }
});
