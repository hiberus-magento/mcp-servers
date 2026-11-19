// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The SKU travels as one URL path segment, so an agent must learn
// from the input itself that a `/` in it can be answered 404 by Apache.
import { describe, expect, it } from "vitest";
import { sku, storeCode } from "./inputs.js";

describe("shared inputs", () => {
  it("the sku input warns that a / in it can be answered 404 behind Apache", () => {
    expect(sku.description).toMatch(/\//);
    expect(sku.description).toMatch(/404/);
    expect(sku.description).toMatch(/AllowEncodedSlashes/);
  });

  it("the store_code input says an unknown code is answered as not found", () => {
    expect(storeCode.description).toMatch(/unknown/i);
    expect(storeCode.description).toMatch(/not found/i);
  });
});
