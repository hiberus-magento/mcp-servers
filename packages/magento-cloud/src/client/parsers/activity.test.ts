// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). `activity:log` is deliberately excluded —
// its output is plain deployment-log text, not a tabular/key-value shape
// (see `test/fake-bin/fixtures/activity-log.txt`); callers pass its raw
// stdout through unparsed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseActivityGet, parseActivityList } from "./activity.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

/**
 * The ONE probe for the field this parser exists to keep out, used by both the
 * leak assertion and its positive control. Case-insensitive because the CLI
 * prints the column header `Description` while a record key would be
 * `description` — a case-sensitive probe would pass against the header row
 * while proving nothing.
 */
const mentionsDescription = (text: string) => /description/i.test(text);

describe("parseActivityList", () => {
  // CHANGED DELIBERATELY: the previous expectation encoded the CLI's DEFAULT
  // column set (`ID Created Description Progress State Result`). `activity:list`
  // is now invoked with an explicit `--columns` set (`../commands.ts`), so the
  // real header row is the one below — `Description` is not requested at all,
  // and `Type` (a machine enum) plus the four deployment timings are.
  it("maps activity:list rows keyed by header", () => {
    expect(parseActivityList(readFixture("activity-list.txt"))).toEqual([
      {
        id: "act-demo-0001",
        created: "2026-01-01T00:00:00+00:00",
        type: "environment.push",
        state: "complete",
        result: "success",
        progress: "100%",
        completed: "2026-01-01T00:05:00+00:00",
        build_time_s: "42",
        deploy_time_s: "18",
        exec_time_s: "3",
        wait_time_s: "1",
      },
      {
        id: "act-demo-0002",
        created: "2026-01-02T00:00:00+00:00",
        type: "environment.redeploy",
        state: "complete",
        result: "failure",
        progress: "100%",
        completed: "2026-01-02T00:04:00+00:00",
        build_time_s: "0",
        deploy_time_s: "25",
        exec_time_s: "2",
        wait_time_s: "0",
      },
      {
        id: "act-demo-0003",
        created: "2026-01-03T00:00:00+00:00",
        type: "environment_type.access.delete",
        state: "complete",
        result: "success",
        progress: "100%",
        completed: "2026-01-03T00:00:03+00:00",
        build_time_s: "0",
        deploy_time_s: "0",
        exec_time_s: "1",
        wait_time_s: "0",
      },
    ]);
  });

  it("POSITIVE CONTROL: output missing a required header still throws", () => {
    expect(() => parseActivityList("ID\tCreated\nact-demo-0001\t2026-01-01T00:00:00+00:00\n")).toThrow(
      MagentoCloudOutputShapeError,
    );
  });
});

// A `Description` cell reads "<person> removed user <person> from environment
// type production" — content-level PII that no field allowlist on the CLI side
// can filter. `--columns` means we do not ask for it; this suite proves the
// parser would not hand it on even if it arrived anyway (a CLI default change,
// a dropped flag, an operator running the command by hand).
const ACTIVITY_LIST_DESCRIPTION_MARKER = "DEMOACTIVITYDESCRIPTION";
const activityListWithDescriptionColumn = () =>
  "ID\tCreated\tType\tState\tResult\tProgress\tCompleted\tBuild time (s)\tDeploy time (s)\tExec time (s)\tWait time (s)\tDescription\n" +
  `act-demo-0003\t2026-01-03T00:00:00+00:00\tenvironment_type.access.delete\tcomplete\tsuccess\t100%\t2026-01-03T00:00:03+00:00\t0\t0\t1\t0\t${ACTIVITY_LIST_DESCRIPTION_MARKER}\n`;

describe("parseActivityList — description is never projected", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: a narrow return type is a compile-time claim only, and
  // `rowsToRecords` keys a record by EVERY header the CLI printed.
  it("cannot leak a Description column even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseActivityList(activityListWithDescriptionColumn()));

    expect(mentionsDescription(serialized)).toBe(false);
    expect(serialized).not.toContain(ACTIVITY_LIST_DESCRIPTION_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find the marker in the raw text.
  // Without this, a probe that simply cannot see `description` would "pass".
  it("positive control: the same probe finds the description in the raw CLI output", () => {
    const raw = activityListWithDescriptionColumn();

    expect(mentionsDescription(raw)).toBe(true);
    expect(raw).toContain(ACTIVITY_LIST_DESCRIPTION_MARKER);
  });
});

describe("parseActivityGet", () => {
  // CHANGED DELIBERATELY: `description` left the allowlist and left the
  // fixture. It is the same free-text, person-naming field as the list
  // column — singular rather than per-row, and no less personal. The five
  // remaining non-required key NAMES were verified against the live CLI's
  // `activity:get` key set; only their values here are synthetic.
  it("maps activity:get to its allowlisted fields", () => {
    const activity = parseActivityGet(readFixture("activity-get.txt"));

    expect(activity).toEqual({
      id: "act-demo-0001",
      type: "environment.push",
      state: "complete",
      result: "success",
      completion_percent: "100",
      created_at: "2026-01-01T00:00:00+00:00",
      completed_at: "2026-01-01T00:05:00+00:00",
    });
    expect(activity).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseActivityGet("Property\tValue\nid\tact-demo-0001\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// `parameters`, `text` and `commands` carry arbitrary payloads — whatever the
// activity happened to be handed. None of them can be reasoned about ahead of
// time, so none of them is allowlisted. `description` is dropped for a
// different reason: the real CLI DOES still print it here (unlike the list,
// where `--columns` means it is never fetched), and its content is PII.
const ACTIVITY_GET_DESCRIPTION_MARKER = "DEMOACTIVITYDESCRIPTION";
const ACTIVITY_GET_UNDECLARED_PAIRS =
  `parameters\tDEMOPARAMETERS\ntext\tDEMOACTIVITYTEXT\ncommands\tDEMOCOMMANDS\ndescription\t${ACTIVITY_GET_DESCRIPTION_MARKER}\n`;

const activityGetWithUndeclaredPairs = () => readFixture("activity-get.txt") + ACTIVITY_GET_UNDECLARED_PAIRS;

describe("parseActivityGet — undeclared keys", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: the narrow return type is a compile-time claim only.
  it("cannot leak an undeclared key even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseActivityGet(activityGetWithUndeclaredPairs()));

    expect(serialized).not.toContain("parameters");
    expect(serialized).not.toContain("DEMOPARAMETERS");
    expect(serialized).not.toContain("text");
    expect(serialized).not.toContain("DEMOACTIVITYTEXT");
    expect(serialized).not.toContain("commands");
    expect(serialized).not.toContain("DEMOCOMMANDS");
    expect(mentionsDescription(serialized)).toBe(false);
    expect(serialized).not.toContain(ACTIVITY_GET_DESCRIPTION_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find every marker in the raw text.
  it("positive control: the same probe finds each dropped key in the raw CLI output", () => {
    const raw = activityGetWithUndeclaredPairs();

    expect(raw).toContain("parameters");
    expect(raw).toContain("DEMOPARAMETERS");
    expect(raw).toContain("text");
    expect(raw).toContain("DEMOACTIVITYTEXT");
    expect(raw).toContain("commands");
    expect(raw).toContain("DEMOCOMMANDS");
    expect(mentionsDescription(raw)).toBe(true);
    expect(raw).toContain(ACTIVITY_GET_DESCRIPTION_MARKER);
  });
});
