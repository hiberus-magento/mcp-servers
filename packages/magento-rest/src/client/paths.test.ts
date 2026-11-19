// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first: the original server interpolated caller input raw into REST
// paths (`/products/${sku}`), so a SKU of `a/../../customers` re-addressed
// the request to a different Magento endpoint. `restPath` is the ONLY way
// this package builds a path, and it encodes every interpolated segment.
import { describe, expect, it } from "vitest";
import { restPath } from "./paths.js";

describe("restPath", () => {
  it("leaves a plain segment untouched", () => {
    expect(restPath`/products/${"DEMO-TENT-001"}`).toBe("/products/DEMO-TENT-001");
  });

  it("encodes a slash so a SKU cannot add a path segment", () => {
    expect(restPath`/products/${"a/b"}`).toBe("/products/a%2Fb");
  });

  it("neutralises dot segments that would traverse to another endpoint", () => {
    expect(restPath`/products/${".."}`).toBe("/products/%2E%2E");
    expect(restPath`/products/${"."}`).toBe("/products/%2E");
  });

  it("leaves an inner dot alone, so a SKU like v1.2 stays readable", () => {
    expect(restPath`/products/${"v1.2"}`).toBe("/products/v1.2");
  });

  it("encodes ? and # so a value cannot start a query or fragment", () => {
    expect(restPath`/products/${"x?admin=1#y"}`).toBe("/products/x%3Fadmin%3D1%23y");
  });

  it("encodes a percent sign, so a pre-encoded value is not double-interpreted", () => {
    expect(restPath`/products/${"%2F"}`).toBe("/products/%252F");
  });

  it("accepts a number and encodes it as a decimal", () => {
    expect(restPath`/orders/${42}`).toBe("/orders/42");
  });

  it("rejects an empty segment rather than producing //", () => {
    expect(() => restPath`/products/${""}`).toThrow(/empty/i);
  });

  it("encodes every interpolation in a multi-segment path", () => {
    expect(restPath`/products/${"a/b"}/media/${7}`).toBe("/products/a%2Fb/media/7");
  });
});
