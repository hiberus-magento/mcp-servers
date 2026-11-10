// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `normalizeCountry`. The original's
// fallback was to upper-case WHATEVER it was given and use that as a code, so
// "Narnia" became "NARNIA", matched no order, and the report said zero — an
// answer that looks like data. An input that is neither a known name nor a
// two-letter code is now unrecognised, and the tool refuses it.
import { describe, expect, it } from "vitest";
import { normalizeCountry } from "./countries.js";

describe("normalizeCountry", () => {
  it.each([
    ["Spain", "ES"],
    ["spain", "ES"],
    ["  The Netherlands ", "NL"],
    ["Holland", "NL"],
    ["united states", "US"],
    ["USA", "US"],
    ["America", "US"],
    ["UK", "GB"],
    ["Great Britain", "GB"],
    ["England", "GB"],
    ["South Africa", "ZA"],
    ["Germany", "DE"],
  ])("%s -> %s", (input, code) => {
    expect(normalizeCountry(input)).toBe(code);
  });

  it.each([["es", "ES"], ["ES", "ES"], ["Fr", "FR"], ["zz", "ZZ"]])("a two-letter code %s is upper-cased: %s", (input, code) => {
    expect(normalizeCountry(input)).toBe(code);
  });

  it.each(["Narnia", "", " ", "E", "ESP", "E5", "es&x=1", "x".repeat(65)])("does not recognise %j", (input) => {
    expect(normalizeCountry(input)).toBeUndefined();
  });
});
