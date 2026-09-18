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
  it("maps activity:get's field/value rows", () => {
    expect(parseActivityGet(readFixture("activity-get.txt"))).toEqual({
      id: "act-demo-0001",
      type: "environment.push",
      state: "complete",
    });
  });
});
