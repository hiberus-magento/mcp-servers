// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `templates/magento-rest-fields.json` is an example a team copies
// and points MAGENTO_REST_FIELDS_FILE at, so it must be a file the server
// really accepts, every line must change something (an example that adds a
// field already shipped teaches nothing), and, because it is copied as it is,
// it must not widen personal data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyFieldConfig, parseFieldConfig } from "./tools/field-config.js";
import { BASE_SHAPES } from "./tools/shapes.js";

const text = readFileSync(fileURLToPath(new URL("../templates/magento-rest-fields.json", import.meta.url)), "utf8");
const PERSONAL_RESOURCES = ["customer", "customer_summary", "customer_address", "order", "order_summary", "cart", "cart_summary", "abandoned_cart"];

describe("templates/magento-rest-fields.json", () => {
  it("is accepted by the same parser the server uses at startup", () => {
    expect(() => parseFieldConfig(text)).not.toThrow();
  });

  it("is not empty", () => {
    expect(Object.keys(parseFieldConfig(text)).length).toBeGreaterThan(0);
  });

  it("shows both commands, `add` and `remove`", () => {
    const changes = Object.values(parseFieldConfig(text));
    expect(changes.some((change) => (change?.add ?? []).length > 0)).toBe(true);
    expect(changes.some((change) => (change?.remove ?? []).length > 0)).toBe(true);
  });

  it("adds, for every path it lists, a field the shipped list does not already allow", () => {
    for (const [resource, change] of Object.entries(parseFieldConfig(text))) {
      for (const path of change?.add ?? []) {
        const widened = applyFieldConfig(BASE_SHAPES, { [resource]: { add: [path] } });
        const name = resource as keyof typeof BASE_SHAPES;
        expect(JSON.stringify(widened[name]), `${resource}.${path}`).not.toBe(JSON.stringify(BASE_SHAPES[name]));
      }
    }
  });

  it("removes, for every path it lists, a field that is really on the shipped list", () => {
    for (const [resource, change] of Object.entries(parseFieldConfig(text))) {
      for (const path of change?.remove ?? []) {
        const narrowed = applyFieldConfig(BASE_SHAPES, { [resource]: { remove: [path] } });
        const name = resource as keyof typeof BASE_SHAPES;
        expect(JSON.stringify(narrowed[name]), `${resource}.${path}`).not.toBe(JSON.stringify(BASE_SHAPES[name]));
      }
    }
  });

  it("applies as a whole to the shipped lists without error", () => {
    expect(() => applyFieldConfig(BASE_SHAPES, parseFieldConfig(text))).not.toThrow();
  });

  it("does not widen resources that carry personal data", () => {
    const widened = Object.entries(parseFieldConfig(text)).filter(([, change]) => (change?.add ?? []).length > 0);
    expect(widened.map(([resource]) => resource).filter((resource) => PERSONAL_RESOURCES.includes(resource))).toEqual([]);
  });
});
