// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 3.8; design.md Decision 6):
// `EDS_PROTECTED_SITES` is a comma-separated list of patterns where `*` is
// the only special character; matching is anchored and case-sensitive. No
// regular expression is ever built from the environment.
import { describe, expect, it } from "vitest";
import { matchesSitePattern, parseProtectedSites } from "./protected-sites.js";

describe("parseProtectedSites", () => {
  it("splits on commas and trims each pattern", () => {
    expect(parseProtectedSites(" acme-demo-site-eu , *-us ")).toEqual(["acme-demo-site-eu", "*-us"]);
  });

  it("drops empty entries", () => {
    expect(parseProtectedSites("a,,b,")).toEqual(["a", "b"]);
  });

  it.each([[undefined], [""], ["  "], [" , "]])("is empty for %j — nothing is protected", (value) => {
    expect(parseProtectedSites(value)).toEqual([]);
  });

  it("matches a site against any pattern in the list", () => {
    const patterns = parseProtectedSites("acme-demo-site-eu,*-us");

    expect(matchesSitePattern("acme-demo-site-eu", patterns)).toBe(true);
    expect(matchesSitePattern("acme-demo-site-us", patterns)).toBe(true);
    expect(matchesSitePattern("acme-demo-site-uk", patterns)).toBe(false);
  });

  it("matches nothing with no patterns", () => {
    expect(matchesSitePattern("acme-demo-site-eu", [])).toBe(false);
  });
});

describe("matchesSitePattern", () => {
  it.each([
    ["*-us", "acme-demo-site-us", true],
    ["acme-*", "acme-demo-site-us", true],
    ["acme-*-us", "acme-demo-site-us", true],
    ["*demo*", "acme-demo-site-us", true],
    ["*", "acme-demo-site-us", true],
    ["acme-demo-site-us*", "acme-demo-site-us", true],
  ])("`*` matches any run of characters, including none: %s vs %s", (pattern, site, expected) => {
    expect(matchesSitePattern(site, [pattern])).toBe(expected);
  });

  it.each([
    ["demo", "acme-demo-site-us"],
    ["acme-demo-site", "acme-demo-site-us"],
    ["demo-site-us", "acme-demo-site-us"],
    ["*-eu", "acme-demo-site-us"],
    ["acme-*-eu", "acme-demo-site-us"],
  ])("is anchored at both ends: %s does not match %s", (pattern, site) => {
    expect(matchesSitePattern(site, [pattern])).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(matchesSitePattern("acme-demo-site-us", ["ACME-*"])).toBe(false);
    expect(matchesSitePattern("acme-demo-site-us", ["*-US"])).toBe(false);
  });

  it.each([
    ["acme.demo", "acme.demo", true],
    ["acme.demo", "acmeXdemo", false],
    ["acme+", "acme+", true],
    ["acme+", "acmee", false],
    ["acme?", "acmee", false],
    ["[ab]", "a", false],
    ["acme|other", "other", false],
    ["^acme$", "acme", false],
    ["acme\\d", "acme1", false],
  ])("treats every other character literally: %s vs %s", (pattern, site, expected) => {
    expect(matchesSitePattern(site, [pattern])).toBe(expected);
  });

  it("stays fast on a pattern full of wildcards that does not match", () => {
    const pattern = `${"*a".repeat(30)}*b`;
    const site = "a".repeat(200);
    const started = performance.now();

    expect(matchesSitePattern(site, [pattern])).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
