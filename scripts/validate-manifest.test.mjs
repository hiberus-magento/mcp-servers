// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.2: a valid servers.json entry passes
// schema validation; an entry missing a required field fails and names it.
import { describe, expect, it } from "vitest";
import { validateServersManifest } from "./validate-manifest.mjs";

function validEntry() {
  return {
    id: "example-domain",
    package: "@hiberus-magento/example-domain",
    bin: "example-domain",
    version: "0.0.0",
    domain: "example",
    status: "internal",
    description: "A synthetic example server used only in tests.",
    tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
  };
}

describe("validateServersManifest", () => {
  it("passes for a manifest with one fully-populated entry", () => {
    const result = validateServersManifest({ servers: [validEntry()] });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails and names the missing field when description is absent", () => {
    const entry = validEntry();
    delete entry.description;
    const result = validateServersManifest({ servers: [entry] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("description"))).toBe(true);
  });
});
