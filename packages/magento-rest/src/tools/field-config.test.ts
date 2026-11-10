// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. A field configuration lets an operator WIDEN what a resource
// exposes (`add`) or NARROW it (`remove`), and widening is exactly the kind of
// switch this repository refuses to make easy to flip by accident: there is no
// variable that turns secret redaction off, because that is what a compromised
// environment would set. So the only keys are `add` and `remove` (no `*`, no
// `replace`), every name is validated, a floor of credential and payment
// fields cannot be added by any file, and `remove` can only take away what is
// really on the shipped list and never the identifiers a tool chain needs.
import { describe, expect, it } from "vitest";
import { FieldConfigError, applyFieldConfig, parseFieldConfig } from "./field-config.js";
import { project } from "./project.js";
import { BASE_SHAPES } from "./shapes.js";

const parse = (value: unknown): ReturnType<typeof parseFieldConfig> => parseFieldConfig(JSON.stringify(value));

describe("parseFieldConfig", () => {
  it("accepts an empty object: nothing added", () => {
    expect(parse({})).toEqual({});
  });

  it("accepts additions per resource, top-level and nested", () => {
    expect(parse({ product: { add: ["cost", "extension_attributes.stock_item.qty"] }, website: { add: ["sort_order"] } })).toEqual({
      product: { add: ["cost", "extension_attributes.stock_item.qty"] },
      website: { add: ["sort_order"] },
    });
  });

  it("de-duplicates repeated additions", () => {
    expect(parse({ product: { add: ["cost", "cost"] } })).toEqual({ product: { add: ["cost"] } });
  });

  it("refuses text that is not JSON", () => {
    expect(() => parseFieldConfig("{ nope")).toThrow(FieldConfigError);
    expect(() => parseFieldConfig("{ nope")).toThrow(/JSON/);
  });

  it.each([[[]], [null], ["x"], [1]])("refuses a top level that is not an object: %j", (value) => {
    expect(() => parse(value)).toThrow(/object/);
  });

  it("refuses an unknown resource, naming it and listing the known ones", () => {
    const error = (() => {
      try {
        parse({ prodcut: { add: ["cost"] } });
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(FieldConfigError);
    expect(error?.message).toContain("prodcut");
    expect(error?.message).toContain("product_summary");
  });

  it.each(["replace", "only", "all"])("refuses any key other than `add` and `remove` — here %s — so a file cannot replace a list", (key) => {
    expect(() => parse({ product: { [key]: ["x"] } })).toThrow(new RegExp(`${key}`));
  });

  describe("remove", () => {
    it("accepts removals per resource, top-level and nested, alone or beside additions", () => {
      expect(parse({ product: { remove: ["weight", "extension_attributes.category_links"] }, website: { add: ["sort_order"], remove: ["default_group_id"] } })).toEqual({
        product: { remove: ["weight", "extension_attributes.category_links"] },
        website: { add: ["sort_order"], remove: ["default_group_id"] },
      });
    });

    it("de-duplicates repeated removals", () => {
      expect(parse({ product: { remove: ["weight", "weight"] } })).toEqual({ product: { remove: ["weight"] } });
    });

    it("needs an array of strings", () => {
      expect(() => parse({ product: { remove: "weight" } })).toThrow(/array/);
      expect(() => parse({ product: { remove: [1] } })).toThrow(/string/);
    });

    it.each(["*", "", " ", "a b", "a[0]", "a..b", ".a", "a.", "x".repeat(65), "a.b.c.d.e"])("refuses the malformed path %j", (path) => {
      expect(() => parse({ product: { remove: [path] } })).toThrow(FieldConfigError);
    });

    it("refuses more than 100 removals from one resource", () => {
      expect(() => parse({ product: { remove: Array.from({ length: 101 }, (_, i) => `f${i}`) } })).toThrow(/100/);
    });

    it.each(["id", "sku", "entity_id", "increment_id"])("refuses to remove the identifier %s, which tools need to chain", (path) => {
      expect(() => parse({ product: { remove: [path] } })).toThrow(/identifier/);
    });

    it("does not apply the credential floor: taking a field away is never a leak", () => {
      expect(() => parse({ product: { remove: ["payment_info"] } })).not.toThrow();
    });

    it.each([
      [["cost"], ["cost"]],
      [["extension_attributes"], ["extension_attributes.stock_item.qty"]],
      [["extension_attributes.stock_item.qty"], ["extension_attributes"]],
    ])("refuses adding and removing the same or an enclosing path in one resource: add %j, remove %j", (add, remove) => {
      expect(() => parse({ product: { add, remove } })).toThrow(/both/);
    });

    it("allows the same name in different resources", () => {
      expect(() => parse({ product: { add: ["cost"] }, website: { remove: ["cost"] } })).not.toThrow();
    });
  });

  it("refuses a resource value that is not an object, and an `add` that is not an array of strings", () => {
    expect(() => parse({ product: ["cost"] })).toThrow(/object/);
    expect(() => parse({ product: { add: "cost" } })).toThrow(/array/);
    expect(() => parse({ product: { add: [1] } })).toThrow(/string/);
    expect(() => parse({ product: {} })).toThrow(/add/);
    expect(() => parse({ product: {} })).toThrow(/remove/);
  });

  it.each(["*", "", " ", "a b", "a&b", "a[0]", "a..b", ".a", "a.", "a/b", "x".repeat(65), "a.b.c.d.e"])("refuses the malformed path %j", (path) => {
    expect(() => parse({ product: { add: [path] } })).toThrow(FieldConfigError);
  });

  it("refuses more than 100 additions to one resource", () => {
    expect(() => parse({ product: { add: Array.from({ length: 101 }, (_, i) => `f${i}`) } })).toThrow(/100/);
  });

  describe("the floor: credentials and payment can never be added", () => {
    it.each([
      "password_hash",
      "password",
      "rp_token",
      "token",
      "api_key",
      "apikey",
      "secret",
      "payment",
      "payment.cc_number",
      "extension_attributes.payment_additional_info",
      "cc_last4",
      "card_number",
      "cvv",
      "iban",
      "private_key",
      "credential",
      "PASSWORD_HASH",
    ])("refuses %s", (path) => {
      const call = () => parse({ product: { add: [path] } });
      expect(call).toThrow(FieldConfigError);
      expect(call).toThrow(/cannot be added by configuration/);
    });

    it("applies to a segment anywhere in a nested path", () => {
      expect(() => parse({ product: { add: ["extension_attributes.stock_item.secret_note"] } })).toThrow(/cannot be added/);
    });

    it("does not refuse ordinary business fields", () => {
      expect(() => parse({ product: { add: ["cost", "country_of_manufacture", "special_price", "meta_title"] } })).not.toThrow();
    });
  });
});

describe("applyFieldConfig", () => {
  const add = (resource: string, ...paths: string[]) => ({ [resource]: { add: paths } });
  it("returns the base shapes unchanged for an empty configuration", () => {
    expect(applyFieldConfig(BASE_SHAPES, {})).toEqual(BASE_SHAPES);
  });

  it("adds a top-level field, which then survives projection", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "cost"));
    expect(project({ id: 1, cost: 12, leak_probe: "do-not-leak" }, shapes.product)).toEqual({ id: 1, cost: 12 });
  });

  it("adds a nested leaf and nothing else beside it", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "extension_attributes.stock_item.qty"));
    const out = project({ extension_attributes: { stock_item: { qty: 5, item_id: 9 }, other: "x" } }, shapes.product);
    expect(out).toEqual({ extension_attributes: { stock_item: { qty: 5 } } });
  });

  it("merges into an existing nested entry without losing what was already allowed", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "extension_attributes.stock_item.qty"));
    const out = project({ extension_attributes: { category_links: [{ category_id: "3", position: 0 }], stock_item: { qty: 5 } } }, shapes.product);
    expect(out).toEqual({ extension_attributes: { category_links: [{ category_id: "3", position: 0 }], stock_item: { qty: 5 } } });
  });

  it("an addition alone never removes a base field", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "cost"));
    expect(project({ sku: "A", name: "N" }, shapes.product)).toEqual({ sku: "A", name: "N" });
  });

  it("does not add a field that is already listed, twice", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "sku"));
    expect(shapes.product.filter((entry) => entry === "sku")).toHaveLength(1);
  });

  it("touches only the named resource, and does not mutate the shapes it was given", () => {
    const before = JSON.stringify(BASE_SHAPES);
    const shapes = applyFieldConfig(BASE_SHAPES, add("website", "sort_order"));
    expect(JSON.stringify(BASE_SHAPES)).toBe(before);
    expect(shapes.product).toEqual(BASE_SHAPES.product);
    expect(shapes.website).toContain("sort_order");
  });

  it("an object under an added plain field is still dropped — addition does not widen by depth", () => {
    const shapes = applyFieldConfig(BASE_SHAPES, add("product", "media_gallery_entries"));
    expect(project({ media_gallery_entries: [{ file: "x.jpg" }] }, shapes.product)).toEqual({});
  });

  describe("remove", () => {
    const remove = (resource: string, ...paths: string[]) => ({ [resource]: { remove: paths } });

    it("takes a shipped top-level field away, and projection then drops it", () => {
      const shapes = applyFieldConfig(BASE_SHAPES, remove("product", "weight"));
      expect(shapes.product).not.toContain("weight");
      expect(project({ sku: "A", name: "N", weight: 3 }, shapes.product)).toEqual({ sku: "A", name: "N" });
    });

    it("takes a nested leaf away and keeps its siblings", () => {
      const base = { ...BASE_SHAPES, product: ["sku", ["extension_attributes", ["a", "b"]]] as const };
      const shapes = applyFieldConfig(base, remove("product", "extension_attributes.a"));
      expect(project({ sku: "A", extension_attributes: { a: 1, b: 2 } }, shapes.product)).toEqual({ sku: "A", extension_attributes: { b: 2 } });
    });

    it("takes a whole nested group away when the path names the group", () => {
      const base = { ...BASE_SHAPES, product: ["sku", ["extension_attributes", ["a", "b"]]] as const };
      const shapes = applyFieldConfig(base, remove("product", "extension_attributes"));
      expect(project({ sku: "A", extension_attributes: { a: 1 } }, shapes.product)).toEqual({ sku: "A" });
    });

    it("drops a nested group left with nothing in it", () => {
      const base = { ...BASE_SHAPES, product: ["sku", ["extension_attributes", ["a"]]] as const };
      const shapes = applyFieldConfig(base, remove("product", "extension_attributes.a"));
      expect(shapes.product).toEqual(["sku"]);
    });

    it("refuses a path that is not on the shipped list, naming it, so a typo cannot pass for a removal", () => {
      const call = () => applyFieldConfig(BASE_SHAPES, remove("product", "weigth"));
      expect(call).toThrow(FieldConfigError);
      expect(call).toThrow(/weigth/);
      expect(call).toThrow(/shipped list/);
    });

    it("refuses a path that is only half there: a leaf under a plain field", () => {
      expect(() => applyFieldConfig(BASE_SHAPES, remove("product", "weight.unit"))).toThrow(/shipped list/);
    });

    it("refuses to leave a resource with no fields", () => {
      const base = { ...BASE_SHAPES, website: ["name"] as const };
      expect(() => applyFieldConfig(base, remove("website", "name"))).toThrow(/no fields/);
    });

    it("applies removals and additions to the same resource together", () => {
      const shapes = applyFieldConfig(BASE_SHAPES, { product: { add: ["cost"], remove: ["weight"] } });
      expect(project({ sku: "A", weight: 3, cost: 12 }, shapes.product)).toEqual({ sku: "A", cost: 12 });
    });

    it("touches only the named resource and does not mutate the shapes it was given", () => {
      const before = JSON.stringify(BASE_SHAPES);
      const shapes = applyFieldConfig(BASE_SHAPES, remove("website", "default_group_id"));
      expect(JSON.stringify(BASE_SHAPES)).toBe(before);
      expect(shapes.product).toEqual(BASE_SHAPES.product);
    });
  });
});
