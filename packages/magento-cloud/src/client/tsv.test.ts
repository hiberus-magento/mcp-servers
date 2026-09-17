// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.7-3.8). The CLI's `renderCsv($rows, $header, "\t")`
// delegates to a real CSV formatter (design.md, Decision 4), so a value
// containing a tab or a newline arrives QUOTED. `naive split("\t")` is
// shown wrong first, against the exact fixture corpus the fake binary
// itself emits (`test/fake-bin/fixtures/embedded-{tab,newline}.txt`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "./errors.js";
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "./tsv.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin/fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

describe("naive split(\"\\t\") — shown wrong first", () => {
  it("produces the WRONG row/column shape against the embedded-tab fixture", () => {
    const text = readFixture("embedded-tab.txt");
    const lines = text.split("\n").filter((line) => line.length > 0);
    const naiveDataColumns = lines[1]!.split("\t");

    // The quoted field "Demo\tTitle" contains a literal embedded tab, so a
    // naive split produces FOUR columns instead of the real three.
    expect(naiveDataColumns).toHaveLength(4);
  });
});

describe("parseTsvRows — quote-aware, real parser", () => {
  it("round-trips the embedded-tab fixture as one field, correct column count", () => {
    const rows = parseTsvRows(readFixture("embedded-tab.txt"));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["id", "title", "region"]);
    expect(rows[1]).toEqual(["acme-demo-project", "Demo\tTitle", "demo-region.example-domain"]);
  });

  it("round-trips the embedded-newline fixture: value spans the newline, no extra row", () => {
    const rows = parseTsvRows(readFixture("embedded-newline.txt"));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["acme-demo-project", "Multi\nLine Title", "demo-region.example-domain"]);
  });

  it("parses an unquoted simple row with no special handling needed", () => {
    const rows = parseTsvRows("id\tstatus\nacme-demo-env-main\tactive\n");

    expect(rows).toEqual([
      ["id", "status"],
      ["acme-demo-env-main", "active"],
    ]);
  });

  it("a doubled quote inside a quoted field is a single literal quote character", () => {
    const rows = parseTsvRows('id\ttitle\n1\t"She said ""hi"""\n');

    expect(rows[1]).toEqual(["1", 'She said "hi"']);
  });
});

describe("rowsToRecords — keyed by header, never positional index", () => {
  it("maps rows by the header the CLI actually emitted", () => {
    const rows = parseTsvRows(readFixture("embedded-tab.txt"));

    const records = rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title", "region"] });

    expect(records).toEqual([{ id: "acme-demo-project", title: "Demo\tTitle", region: "demo-region.example-domain" }]);
  });

  it("throws MagentoCloudOutputShapeError naming the subcommand, missing header, and headers seen", () => {
    const rows = [
      ["id", "title"],
      ["acme-demo-project", "Demo Storefront"],
    ];

    expect(() => rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title", "region"] })).toThrow(
      MagentoCloudOutputShapeError,
    );
    try {
      rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title", "region"] });
      throw new Error("expected rowsToRecords to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MagentoCloudOutputShapeError);
      const message = (error as Error).message;
      expect(message).toContain("project:list");
      expect(message).toContain("region");
      expect(message).toContain("id");
      expect(message).toContain("title");
    }
  });

  it("tolerates an unknown extra header — strict on our contract, tolerant on theirs", () => {
    const rows = [
      ["id", "title", "extraColumn"],
      ["acme-demo-project", "Demo Storefront", "unused"],
    ];

    const records = rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title"] });

    expect(records).toEqual([{ id: "acme-demo-project", title: "Demo Storefront", extraColumn: "unused" }]);
  });
});

describe("rowsToKeyValueRecord — the field\\tvalue, no-header :info/:get shape", () => {
  it("builds a plain object from field/value row pairs", () => {
    const rows = parseTsvRows("id\tacme-demo-project\ntitle\tDemo Storefront\nregion\tdemo-region.example-domain\n");

    const record = rowsToKeyValueRecord(rows, { subcommand: "project:info", requiredKeys: ["id", "title", "region"] });

    expect(record).toEqual({ id: "acme-demo-project", title: "Demo Storefront", region: "demo-region.example-domain" });
  });

  it("throws MagentoCloudOutputShapeError naming the subcommand, missing key, and keys seen", () => {
    const rows = [["id", "acme-demo-project"]];

    expect(() => rowsToKeyValueRecord(rows, { subcommand: "project:info", requiredKeys: ["id", "title"] })).toThrow(
      MagentoCloudOutputShapeError,
    );
    try {
      rowsToKeyValueRecord(rows, { subcommand: "project:info", requiredKeys: ["id", "title"] });
      throw new Error("expected rowsToKeyValueRecord to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MagentoCloudOutputShapeError);
      const message = (error as Error).message;
      expect(message).toContain("project:info");
      expect(message).toContain("title");
      expect(message).toContain("id");
    }
  });
});
