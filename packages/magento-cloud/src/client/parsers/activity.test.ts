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

describe("parseActivityList", () => {
  // There is no `Type` column in `activity:list` — the real header row is
  // `ID`, `Created`, `Description`, `Progress`, `State`, `Result`. `State`
  // says whether the activity finished; `Result` says how it finished.
  it("maps activity:list rows keyed by header", () => {
    expect(parseActivityList(readFixture("activity-list.txt"))).toEqual([
      {
        id: "act-demo-0001",
        created: "2026-01-01T00:00:00+00:00",
        description: "Demo User pushed to Main",
        progress: "100%",
        state: "complete",
        result: "success",
      },
      {
        id: "act-demo-0002",
        created: "2026-01-02T00:00:00+00:00",
        description: "Demo User redeployed Staging",
        progress: "100%",
        state: "complete",
        result: "failure",
      },
    ]);
  });
});

describe("parseActivityGet", () => {
  // CHANGED DELIBERATELY: the fixture carried only `id`, `type` and `state`,
  // which left five of the eight allowlisted keys with no coverage at all —
  // a projection is only proven by output that actually contains the fields it
  // is supposed to keep. The five key NAMES were verified against the live
  // CLI's `activity:get` key set; only their values here are synthetic.
  it("maps activity:get to its allowlisted fields", () => {
    const activity = parseActivityGet(readFixture("activity-get.txt"));

    expect(activity).toEqual({
      id: "act-demo-0001",
      type: "environment.push",
      state: "complete",
      description: "Demo User pushed to Main",
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
// time, so none of them is allowlisted.
const ACTIVITY_GET_UNDECLARED_PAIRS = "parameters\tDEMOPARAMETERS\ntext\tDEMOACTIVITYTEXT\ncommands\tDEMOCOMMANDS\n";

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
  });
});
