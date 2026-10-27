// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 3.5; design.md Decision 3): a stale
// plan is detected by hashing the canonical JSON of the document the user
// reviewed. Two reads of an unchanged document must hash the same even when
// the server returns its keys in another order.
import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprint } from "./fingerprint.js";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and emits no whitespace", () => {
    expect(canonicalJson({ b: [2, { d: null, c: "x" }], a: 1 })).toBe('{"a":1,"b":[2,{"c":"x","d":null}]}');
  });

  it("keeps array order — arrays are values, not sets", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });

  it("omits undefined object members, as JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("encodes scalars as JSON", () => {
    expect(canonicalJson("é\n\"")).toBe(JSON.stringify("é\n\""));
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(false)).toBe("false");
  });

  it("sorts keys by code unit, independent of locale", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _: 4 })).toBe('{"B":2,"_":4,"a":3,"b":1}');
  });
});

describe("fingerprint", () => {
  it("is the lowercase hex SHA-256 of the canonical JSON", () => {
    expect(fingerprint({ b: [2, { d: null, c: "x" }], a: 1 })).toBe(
      "bc12a6800478621892dcd698236615e6024d73268ee0b7af703034a25e294c92",
    );
  });

  it("is key-order independent", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("changes when any value changes", () => {
    expect(fingerprint({ a: { b: 1 } })).not.toBe(fingerprint({ a: { b: 2 } }));
  });
});
