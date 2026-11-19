// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The trimmer (design D14) reads only the syntax this package's own documents use. This proves it reads every one
// of them, and that it removes nothing from them when the store's schema is the one they were written for: the
// committed introspection fixture, the latest Adobe Commerce with B2B.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readDocument, readStoreSchema, trimDocument } from "../client/index.js";
import { allMagentoGraphqlTools } from "./index.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../scripts/fixtures/magento-graphql-introspection.json", import.meta.url)), "utf8")) as { data: unknown };
const schema = readStoreSchema(fixture.data);
const fixed = allMagentoGraphqlTools().filter((tool) => tool.document !== undefined);

describe("every fixed document of this package and the store-schema trimmer", () => {
  it("covers the curated and the generated tools", () => {
    expect(schema).toBeDefined();
    expect(fixed.length).toBe(allMagentoGraphqlTools().length - 1);
  });

  it.each(fixed.map((tool) => [tool.name, tool.document as string]))("%s is read by the trimmer and unchanged against the fixture's schema", (_name, document) => {
    expect(() => readDocument(document)).not.toThrow();
    if (schema === undefined) throw new Error("fixture unreadable");
    expect(trimDocument(document, schema)).toEqual({ status: "unchanged" });
  });
});
