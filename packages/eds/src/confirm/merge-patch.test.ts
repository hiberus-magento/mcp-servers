// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 3.6, 3.7; design.md Decision 8):
// `config.patch` is RFC 7386 JSON Merge Patch, and the plan shows the
// resulting change as one JSON Pointer entry per changed key.
import { describe, expect, it } from "vitest";
import { applyMergePatch, diffDocuments, InvalidConfigPatchError, mergeConfigPatch } from "./merge-patch.js";

describe("applyMergePatch — RFC 7386 Appendix A", () => {
  const examples: readonly (readonly [unknown, unknown, unknown])[] = [
    [{ a: "b" }, { a: "c" }, { a: "c" }],
    [{ a: "b" }, { b: "c" }, { a: "b", b: "c" }],
    [{ a: "b" }, { a: null }, {}],
    [{ a: "b", b: "c" }, { a: null }, { b: "c" }],
    [{ a: ["b"] }, { a: "c" }, { a: "c" }],
    [{ a: "c" }, { a: ["b"] }, { a: ["b"] }],
    [{ a: { b: "c" } }, { a: { b: "d", c: null } }, { a: { b: "d" } }],
    [{ a: [{ b: "c" }] }, { a: [1] }, { a: [1] }],
    [["a", "b"], ["c", "d"], ["c", "d"]],
    [{ a: "b" }, ["c"], ["c"]],
    [{ a: "foo" }, null, null],
    [{ a: "foo" }, "bar", "bar"],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: "b", c: null }, { a: "b" }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ];

  it.each(examples)("%j + %j = %j", (target, patch, expected) => {
    expect(applyMergePatch(target, patch)).toEqual(expected);
  });

  it("never mutates the target or the patch", () => {
    const target = { a: { b: 1 }, list: [1] };
    const patch = { a: { c: 2 }, list: [2] };

    applyMergePatch(target, patch);

    expect(target).toEqual({ a: { b: 1 }, list: [1] });
    expect(patch).toEqual({ a: { c: 2 }, list: [2] });
  });

  it("treats a __proto__ key in a parsed patch as data, never as the prototype", () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;

    const result = applyMergePatch({}, patch) as Record<string, unknown>;

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
  });
});

describe("mergeConfigPatch", () => {
  it("merges an object patch into the site document", () => {
    expect(mergeConfigPatch({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it.each([[null], [[]], ["text"], [1], [true]])("rejects a non-object patch (%j)", (patch) => {
    expect(() => mergeConfigPatch({ a: 1 }, patch)).toThrow(InvalidConfigPatchError);
  });
});

describe("diffDocuments", () => {
  it("lists exactly the changed keys, by JSON Pointer, with before and after (spec scenario)", () => {
    const before = { a: 1, b: { c: 2 } };
    const after = mergeConfigPatch(before, { b: { c: 3 }, d: true });

    expect(diffDocuments(before, after)).toEqual([
      { pointer: "/b/c", before: 2, after: 3 },
      { pointer: "/d", after: true },
    ]);
  });

  it("reports a removed key with no after", () => {
    expect(diffDocuments({ a: 1, b: 2 }, { a: 1 })).toEqual([{ pointer: "/b", before: 2 }]);
  });

  it("is empty for an identical document, whatever the key order", () => {
    expect(diffDocuments({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toEqual([]);
  });

  it("compares arrays whole, since merge patch replaces them whole", () => {
    expect(diffDocuments({ a: [1, 2] }, { a: [1, 3] })).toEqual([{ pointer: "/a", before: [1, 2], after: [1, 3] }]);
  });

  it("reports a type change at the key where it happens, not below it", () => {
    expect(diffDocuments({ a: { b: 1 } }, { a: "x" })).toEqual([{ pointer: "/a", before: { b: 1 }, after: "x" }]);
  });

  it("escapes ~ and / in keys per RFC 6901", () => {
    expect(diffDocuments({}, { headers: { "/a~b": "v" } })).toEqual([{ pointer: "/headers", after: { "/a~b": "v" } }]);
    expect(diffDocuments({ h: { "/a~b": 1 } }, { h: { "/a~b": 2 } })).toEqual([
      { pointer: "/h/~1a~0b", before: 1, after: 2 },
    ]);
  });

  it("orders entries by pointer so the same change always reads the same", () => {
    const changes = diffDocuments({ z: 1, a: 1 }, { z: 2, a: 2 });

    expect(changes.map((change) => change.pointer)).toEqual(["/a", "/z"]);
  });

  it("does not report a null value as absent", () => {
    expect(diffDocuments({ a: null }, {})).toEqual([{ pointer: "/a", before: null }]);
  });
});
