// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.9): a bare-array site-list response and
// `{ sites: [...] }` must both normalize to the same shape (eds-client
// spec, "Tolerant Site List Response Shape").
import { describe, expect, it } from "vitest";
import { parseSiteList } from "./types.js";

describe("parseSiteList", () => {
  it("accepts a bare array response", () => {
    const result = parseSiteList(["acme-demo-site-eu", "acme-demo-site-us"]);

    expect(result).toEqual({ sites: ["acme-demo-site-eu", "acme-demo-site-us"] });
  });

  it("accepts a { sites: [...] } response, normalizing to the same shape", () => {
    const result = parseSiteList({ sites: ["acme-demo-site-eu", "acme-demo-site-us"] });

    expect(result).toEqual({ sites: ["acme-demo-site-eu", "acme-demo-site-us"] });
  });

  // RED-first (eds-write-surface tasks.md 2.3): the OpenAPI contract 12.145.0
  // documents `{ sites: [{ name }] }` — objects, not strings. The two shapes
  // above were inferred; this one is the documented one.
  it("accepts the documented { sites: [{ name }] } response, normalizing to names", () => {
    const result = parseSiteList({ sites: [{ name: "acme-demo-site-eu" }, { name: "acme-demo-site-us" }] });

    expect(result).toEqual({ sites: ["acme-demo-site-eu", "acme-demo-site-us"] });
  });
});
