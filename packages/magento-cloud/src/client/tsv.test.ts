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
import { normalizeHeaderName, parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "./tsv.js";

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
    expect(rows[0]).toEqual(["ID", "Title", "Region"]);
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

  // CHANGED DELIBERATELY: the extra column was `extraColumn`, a camelCase
  // name the real CLI never prints — it prints a spaced, Capitalised label.
  // The assertion now says what a caller actually receives for one: the
  // normalized key, not the display label.
  it("tolerates an unknown extra header — strict on our contract, tolerant on theirs", () => {
    const rows = [
      ["ID", "Title", "Future Column"],
      ["acme-demo-project", "Demo Storefront", "unused"],
    ];

    const records = rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title"] });

    expect(records).toEqual([{ id: "acme-demo-project", title: "Demo Storefront", future_column: "unused" }]);
  });
});

// ---------------------------------------------------------------------------
// RED-first for the shape the real CLI actually emits (captured by a live
// smoke test; every value below is synthetic). A tabular header row is
// Capitalised and a header cell may carry spaces, parentheses, or `%` — `ID`,
// `Disk (MiB)`, `% used`. Matching a required header with an exact,
// case-sensitive `includes()` therefore rejected real output for 7 of the 8
// tools.
// ---------------------------------------------------------------------------

describe("normalizeHeaderName — the one place a CLI header becomes a record key", () => {
  it.each([
    ["ID", "id"],
    ["Title", "title"],
    ["To", "to"],
    ["Disk (MiB)", "disk_mib"],
    ["% used", "percent_used"],
    ["Allocated disk", "allocated_disk"],
    ["Estimated usage", "estimated_usage"],
    // `activity:list`'s four timing columns: a trailing `(s)` collapses to a
    // single `_s` suffix, and the trailing `_` left by the closing paren is
    // trimmed. Pinned here because `activity.ts`'s required-header list has to
    // spell these exactly, and they are the least guessable names in it.
    ["Build time (s)", "build_time_s"],
    ["Deploy time (s)", "deploy_time_s"],
    ["Exec time (s)", "exec_time_s"],
    ["Wait time (s)", "wait_time_s"],
    // The header cells the four remaining `--columns` sets produce that a
    // reader would most plausibly get wrong: `environment:list`'s
    // `machine_name` column is headed with a SPACE, `route:list`'s `url`
    // column is headed in caps, and `project:list`'s `created_at` column is
    // headed `Created` — not `Created at`, so the record key is `created`.
    ["Machine name", "machine_name"],
    ["URL", "url"],
    ["Created", "created"],
    ["Updated", "updated"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeHeaderName(raw)).toBe(expected);
  });

  it("is idempotent — an already-normalized name normalizes to itself", () => {
    expect(normalizeHeaderName("percent_used")).toBe("percent_used");
  });
});

describe("rowsToRecords — against the REAL Capitalised header row", () => {
  it("matches required headers against the normalized name and keys records by it", () => {
    const rows = parseTsvRows("ID\tTitle\tRegion\nacme-demo-project\tDemo Storefront\tdemo-region.example-domain\n");

    const records = rowsToRecords(rows, { subcommand: "project:list", requiredHeaders: ["id", "title", "region"] });

    expect(records).toEqual([{ id: "acme-demo-project", title: "Demo Storefront", region: "demo-region.example-domain" }]);
  });

  it("normalizes a header cell carrying spaces, parentheses, and a percent sign", () => {
    const rows = parseTsvRows("Allocated disk\tEstimated usage\t% used\n2147483648\t1073741824\t50\n");

    const records = rowsToRecords(rows, {
      subcommand: "db:size",
      requiredHeaders: ["allocated_disk", "estimated_usage", "percent_used"],
    });

    expect(records).toEqual([{ allocated_disk: "2147483648", estimated_usage: "1073741824", percent_used: "50" }]);
  });

  it("POSITIVE CONTROL: a genuinely missing required header still throws, naming the headers as the CLI emitted them", () => {
    const rows = parseTsvRows("Route\tType\nhttps://demo.example-domain/\tupstream\n");

    try {
      rowsToRecords(rows, { subcommand: "route:list", requiredHeaders: ["route", "type", "to"] });
      throw new Error("expected rowsToRecords to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MagentoCloudOutputShapeError);
      const message = (error as Error).message;
      expect(message).toContain("route:list");
      expect(message).toContain('"to"');
      expect(message).toContain("Route");
      expect(message).toContain("Type");
    }
  });

  it("still tolerates an unknown extra column, keyed by its normalized name", () => {
    const rows = parseTsvRows("Name\tType\tDisk (MiB)\tSize\tFuture Column\ndatabase\tmysql:10.6\t2048\tM\tunused\n");

    const records = rowsToRecords(rows, { subcommand: "service:list", requiredHeaders: ["name", "type"] });

    expect(records).toEqual([{ name: "database", type: "mysql:10.6", disk_mib: "2048", size: "M", future_column: "unused" }]);
  });
});

describe("rowsToKeyValueRecord — against the REAL key/value shape", () => {
  it("SKIPS the literal Property/Value header row instead of ingesting it as data", () => {
    const rows = parseTsvRows("Property\tValue\nid\tacme-demo-project\n");

    const record = rowsToKeyValueRecord<Record<string, string>>(rows, { subcommand: "project:info", requiredKeys: ["id"] });

    expect(record).not.toHaveProperty("Property");
    expect(Object.keys(record)).toEqual(["id"]);
  });

  it("ignores an INDENTED continuation line of a nested block, and the bare key line that opens it", () => {
    const text = [
      "Property\tValue",
      "id\tacme-demo-env-main",
      "sizing",
      "    resources:",
      "        profile_size\tM",
      "type\tproduction",
    ].join("\n");
    const rows = parseTsvRows(`${text}\n`);

    const record = rowsToKeyValueRecord<Record<string, string>>(rows, {
      subcommand: "environment:info",
      requiredKeys: ["id", "type"],
    });

    expect(Object.keys(record)).toEqual(["id", "type"]);
    expect(record).toEqual({ id: "acme-demo-env-main", type: "production" });
  });

  it("POSITIVE CONTROL: a missing required key still throws even when the Property/Value header is present", () => {
    const rows = parseTsvRows("Property\tValue\nid\tacme-demo-project\n");

    try {
      rowsToKeyValueRecord(rows, { subcommand: "project:info", requiredKeys: ["id", "title"] });
      throw new Error("expected rowsToKeyValueRecord to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MagentoCloudOutputShapeError);
      const message = (error as Error).message;
      expect(message).toContain("project:info");
      expect(message).toContain("title");
      expect(message).not.toContain("Property");
    }
  });

  it("POSITIVE CONTROL: the continuation-line skip never drops a legitimate top-level pair", () => {
    const rows = parseTsvRows("Property\tValue\nfirst_name\tDemo\nlast_name\tUser\n");

    const record = rowsToKeyValueRecord<Record<string, string>>(rows, {
      subcommand: "auth:info",
      requiredKeys: ["first_name", "last_name"],
    });

    expect(record).toEqual({ first_name: "Demo", last_name: "User" });
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
