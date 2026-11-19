// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. This repository's rule is that results are projected field by
// field from a named allowlist, never spread: a type annotation is a
// compile-time claim only, and Magento adds fields (and extension attributes)
// on every release. The original returned `JSON.stringify(response.data)`
// wholesale, so an order's full payment and address block reached the model.
import { describe, expect, it } from "vitest";
import { project } from "./project.js";

describe("project", () => {
  it("keeps only the listed primitive fields", () => {
    expect(project({ id: 1, sku: "A", secret: "leak" }, ["id", "sku"])).toEqual({ id: 1, sku: "A" });
  });

  it("an extra field is absent from JSON.stringify of the result — the form an agent receives", () => {
    const out = JSON.stringify(project({ id: 1, extension_attributes: { card: "4111" } }, ["id"]));
    expect(out).not.toContain("4111");
    expect(out).not.toContain("extension_attributes");
  });

  it("drops a listed key whose value is an object unless a nested shape is given", () => {
    expect(project({ id: 1, billing: { street: ["x"] } }, ["id", "billing"])).toEqual({ id: 1 });
  });

  it("projects a nested object through its own shape", () => {
    expect(project({ id: 1, billing: { city: "Madrid", street: ["x"] } }, ["id", ["billing", ["city"]]])).toEqual({ id: 1, billing: { city: "Madrid" } });
  });

  it("maps over arrays, at the top level and nested", () => {
    expect(project([{ id: 1, x: 1 }, { id: 2, x: 2 }], ["id"])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(project({ items: [{ sku: "A", cost: 9 }] }, [["items", ["sku"]]])).toEqual({ items: [{ sku: "A" }] });
  });

  it("keeps an array of primitives under a plain key", () => {
    expect(project({ category_ids: ["1", "2"] }, ["category_ids"])).toEqual({ category_ids: ["1", "2"] });
  });

  it("drops an array of objects under a plain key", () => {
    expect(project({ custom_attributes: [{ attribute_code: "a", value: "b" }] }, ["custom_attributes"])).toEqual({});
  });

  it("omits listed keys that are absent, and keeps null", () => {
    expect(project({ id: 1, note: null }, ["id", "note", "missing"])).toEqual({ id: 1, note: null });
  });

  it("returns a primitive top-level value unchanged (a bare `true` from a DELETE)", () => {
    expect(project(true, ["id"])).toBe(true);
  });

  it("does not follow a key through the prototype chain", () => {
    expect(project(JSON.parse('{"__proto__":{"polluted":1},"id":1}'), ["id", "polluted"])).toEqual({ id: 1 });
  });
});
