// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Date-range expressions for reports, ported from the original `date-utils.js`
// and tightened in two ways:
//
//   - EVERYTHING is UTC. Magento stores `created_at` in UTC; the original used
//     the machine's local time, so "today" moved with the host. Only `getUTC*`
//     and `Date.UTC` are used here, never a local-time accessor.
//   - Anything outside the named expressions, one strict calendar date
//     (`YYYY-MM-DD`, validated — `2026-02-30` is refused) or `A to B` is an
//     error. The original's ISO parser took a spread of formats.
//
// Pure: `now` is a parameter, never read from a clock here.
const MS_PER_DAY = 86_400_000;
const MAX_SPAN_DAYS = 3660;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateRange {
  readonly startDate: Date;
  readonly endDate: Date;
  readonly description: string;
}

const dayStart = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month, day));

function startOfUtcDay(date: Date): Date {
  return dayStart(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The last millisecond before `next` begins. */
const justBefore = (next: Date): Date => new Date(next.getTime() - 1);

/** `YYYY-MM-DD HH:MM:SS` in UTC with no milliseconds: the form Magento stores and compares. */
export function formatMagentoTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** `YYYY-MM-DD` in UTC. */
export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A real calendar date, or `undefined`: `2026-02-30` does not round-trip, so it is refused. */
function parseDay(text: string): Date | undefined {
  const match = DAY_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = dayStart(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

function unparseable(expression: string): Error {
  return new Error(`Unable to parse date expression ${JSON.stringify(expression)}. Use today, yesterday, this week, last week, this month, last month, ytd, last year, YYYY-MM-DD, or YYYY-MM-DD to YYYY-MM-DD.`);
}

export function parseDateRange(expression: string, now: Date): DateRange {
  const normalized = expression.toLowerCase().trim();
  const today = startOfUtcDay(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const endOfToday = justBefore(new Date(today.getTime() + MS_PER_DAY));

  switch (normalized) {
    case "today":
      return { startDate: today, endDate: endOfToday, description: "Today" };
    case "yesterday": {
      const start = new Date(today.getTime() - MS_PER_DAY);
      return { startDate: start, endDate: justBefore(today), description: "Yesterday" };
    }
    case "this week":
    case "last week": {
      // Weeks start on Monday: getUTCDay() is 0 for Sunday, so shift it.
      const thisWeekStart = new Date(today.getTime() - ((now.getUTCDay() + 6) % 7) * MS_PER_DAY);
      if (normalized === "this week") {
        return { startDate: thisWeekStart, endDate: endOfToday, description: "This week" };
      }
      return { startDate: new Date(thisWeekStart.getTime() - 7 * MS_PER_DAY), endDate: justBefore(thisWeekStart), description: "Last week" };
    }
    case "this month":
      return { startDate: dayStart(year, month, 1), endDate: endOfToday, description: "This month" };
    case "last month":
      return { startDate: dayStart(year, month - 1, 1), endDate: justBefore(dayStart(year, month, 1)), description: "Last month" };
    case "ytd":
    case "this ytd":
    case "this year to date":
    case "year to date":
      return { startDate: dayStart(year, 0, 1), endDate: endOfToday, description: "Year to date" };
    case "last year":
      return { startDate: dayStart(year - 1, 0, 1), endDate: justBefore(dayStart(year, 0, 1)), description: "Last year" };
    default:
      break;
  }

  const single = parseDay(normalized);
  if (single !== undefined) {
    return { startDate: single, endDate: justBefore(new Date(single.getTime() + MS_PER_DAY)), description: formatDay(single) };
  }

  const parts = normalized.split(" to ");
  if (parts.length === 2) {
    const start = parseDay(parts[0] as string);
    const end = parseDay(parts[1] as string);
    if (start !== undefined && end !== undefined) {
      if (start.getTime() > end.getTime()) {
        throw new Error(`Invalid date range ${JSON.stringify(expression)}: the start date is after the end date.`);
      }
      if ((end.getTime() - start.getTime()) / MS_PER_DAY + 1 > MAX_SPAN_DAYS) {
        throw new Error(`Invalid date range ${JSON.stringify(expression)}: longer than ten years (${MAX_SPAN_DAYS} days).`);
      }
      return { startDate: start, endDate: justBefore(new Date(end.getTime() + MS_PER_DAY)), description: `${formatDay(start)} to ${formatDay(end)}` };
    }
  }

  throw unparseable(expression);
}

/** Whether `parseDateRange` would accept it — for a schema `refine`, where `now` does not matter. */
export function isDateRangeExpression(expression: string): boolean {
  try {
    parseDateRange(expression, new Date(0));
    return true;
  } catch {
    return false;
  }
}
