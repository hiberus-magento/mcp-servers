// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `date-utils.js`, with two changes of
// substance. Everything is resolved in UTC, because Magento stores
// `created_at` in UTC (the original used the server's local time, so a
// "today" report shifted with the machine it ran on). And anything that is not
// one of the named expressions or a strict calendar date is an ERROR: the
// original's ISO parser accepted a spread of formats, including datetimes.
//
// `now` is injected, so no test waits on a clock and "today" is not a moving
// target.
import { describe, expect, it } from "vitest";
import { formatDay, formatMagentoTimestamp, isDateRangeExpression, parseDateRange } from "./date-range.js";

// A Wednesday. 2026-03-01 is a Sunday, so this week began Monday the 9th.
const NOW = new Date("2026-03-11T15:30:00Z");
const range = (expression: string) => {
  const { startDate, endDate, description } = parseDateRange(expression, NOW);
  return { start: formatMagentoTimestamp(startDate), end: formatMagentoTimestamp(endDate), description };
};

describe("parseDateRange: named expressions, in UTC", () => {
  it.each([
    ["today", "2026-03-11 00:00:00", "2026-03-11 23:59:59", "Today"],
    ["yesterday", "2026-03-10 00:00:00", "2026-03-10 23:59:59", "Yesterday"],
    ["this week", "2026-03-09 00:00:00", "2026-03-11 23:59:59", "This week"],
    ["last week", "2026-03-02 00:00:00", "2026-03-08 23:59:59", "Last week"],
    ["this month", "2026-03-01 00:00:00", "2026-03-11 23:59:59", "This month"],
    ["last month", "2026-02-01 00:00:00", "2026-02-28 23:59:59", "Last month"],
    ["ytd", "2026-01-01 00:00:00", "2026-03-11 23:59:59", "Year to date"],
    ["this ytd", "2026-01-01 00:00:00", "2026-03-11 23:59:59", "Year to date"],
    ["this year to date", "2026-01-01 00:00:00", "2026-03-11 23:59:59", "Year to date"],
    ["year to date", "2026-01-01 00:00:00", "2026-03-11 23:59:59", "Year to date"],
    ["last year", "2025-01-01 00:00:00", "2025-12-31 23:59:59", "Last year"],
  ])("%s", (expression, start, end, description) => {
    expect(range(expression)).toEqual({ start, end, description });
  });

  it("ignores case and surrounding space", () => {
    expect(range("  Last Week ")).toEqual(range("last week"));
  });

  it("handles the first of the month and a year boundary", () => {
    expect(parseDateRange("last month", new Date("2026-01-01T00:00:00Z")).startDate.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(formatMagentoTimestamp(parseDateRange("last month", new Date("2026-03-01T00:00:00Z")).endDate)).toBe("2026-02-28 23:59:59");
    expect(formatMagentoTimestamp(parseDateRange("last month", new Date("2024-03-15T00:00:00Z")).endDate)).toBe("2024-02-29 23:59:59");
  });

  it("starts the week on Monday even when today is Sunday or Monday", () => {
    expect(formatDay(parseDateRange("this week", new Date("2026-03-15T10:00:00Z")).startDate)).toBe("2026-03-09");
    expect(formatDay(parseDateRange("this week", new Date("2026-03-09T10:00:00Z")).startDate)).toBe("2026-03-09");
  });

  it("is the same regardless of the host's time zone — it reads UTC fields only", () => {
    const late = new Date("2026-03-11T23:59:59Z");
    const early = new Date("2026-03-11T00:00:00Z");
    expect(range("today")).toEqual(range("today"));
    expect(formatDay(parseDateRange("today", late).startDate)).toBe("2026-03-11");
    expect(formatDay(parseDateRange("today", early).startDate)).toBe("2026-03-11");
  });
});

describe("parseDateRange: a date or a range", () => {
  it("accepts one calendar date", () => {
    expect(range("2026-01-15")).toEqual({ start: "2026-01-15 00:00:00", end: "2026-01-15 23:59:59", description: "2026-01-15" });
  });

  it("accepts `YYYY-MM-DD to YYYY-MM-DD`", () => {
    expect(range("2026-01-01 to 2026-01-31")).toEqual({ start: "2026-01-01 00:00:00", end: "2026-01-31 23:59:59", description: "2026-01-01 to 2026-01-31" });
  });

  it("accepts a one-day range and the leap day", () => {
    expect(range("2026-01-05 to 2026-01-05").start).toBe("2026-01-05 00:00:00");
    expect(range("2024-02-29").description).toBe("2024-02-29");
  });

  it.each(["", "someday", "2026-02-30", "2026-13-01", "2026-1-1", "26-01-01", "2026-01-01T10:00:00", "2026-01-01 10:00:00", "20260101", "2025-02-29", "2026-01-31 to 2026-01-01", "2026-01-01 to", "to 2026-01-01", "2026-01-01 to 2026-01-02 to 2026-01-03", "last fortnight", "tomorrow"])(
    "refuses %j",
    (expression) => {
      expect(() => parseDateRange(expression, NOW)).toThrow(/date/i);
      expect(isDateRangeExpression(expression)).toBe(false);
    },
  );

  it("refuses a range longer than ten years", () => {
    expect(() => parseDateRange("2000-01-01 to 2026-01-01", NOW)).toThrow(/ten years|3660/);
    expect(isDateRangeExpression("2016-03-12 to 2026-03-11")).toBe(true);
  });

  it("isDateRangeExpression is true for every accepted form", () => {
    for (const ok of ["today", "Last Week", "ytd", "2026-01-15", "2026-01-01 to 2026-01-31"]) {
      expect(isDateRangeExpression(ok)).toBe(true);
    }
  });
});

describe("formatters", () => {
  it("formatMagentoTimestamp is `YYYY-MM-DD HH:MM:SS` in UTC, without milliseconds", () => {
    expect(formatMagentoTimestamp(new Date("2026-03-11T15:30:45.678Z"))).toBe("2026-03-11 15:30:45");
  });

  it("formatDay is `YYYY-MM-DD` in UTC", () => {
    expect(formatDay(new Date("2026-03-11T23:59:59Z"))).toBe("2026-03-11");
  });
});
