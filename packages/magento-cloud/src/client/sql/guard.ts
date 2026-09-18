// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `db:sql` hardening guard — one lexer, four rules, two independent
// caps (design.md, Decision 5; magento-cloud-client spec). This is the
// entire reason this package is allowed to exist: the audited fork's
// validator permitted `SELECT * FROM <table>` unbounded against a
// production database. `guardQuery()` is wired as the `db:sql` spec's
// `argsSchema.strict().transform()` (`../commands.ts`), so `mcp-core`'s
// existing guarantee that `buildArgv` is never called on a schema failure
// (`exec.test.ts`'s "rejects a schema-invalid argument without building
// argv") is what makes an unguarded query reaching `execFile` structurally
// impossible through this spec, not a review finding to catch later.
import { lex } from "./lex.js";

declare const Guarded: unique symbol;
/**
 * Branded string — the ONLY way to produce a value of this type is
 * `guardQuery()` returning `{ ok: true }`, exactly mirroring `mcp-core`'s
 * `Argv` brand (`command-spec.ts`). `Guarded` is deliberately NOT exported.
 */
export type GuardedQuery = string & { readonly [Guarded]: true };

export type GuardRejection = { readonly ok: false; readonly message: string };
export type GuardAcceptance = { readonly ok: true; readonly query: GuardedQuery };
export type GuardResult = GuardAcceptance | GuardRejection;

const READ_ONLY_LEADING_VERBS = ["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"] as const;
type ReadOnlyLeadingVerb = (typeof READ_ONLY_LEADING_VERBS)[number];

function isReadOnlyLeadingVerb(verb: string): verb is ReadOnlyLeadingVerb {
  return (READ_ONLY_LEADING_VERBS as readonly string[]).includes(verb);
}

function reject(message: string): GuardRejection {
  return { ok: false, message };
}

function brand(query: string): GuardedQuery {
  return query as GuardedQuery;
}

function leadingVerb(statementText: string): string {
  const match = /^\s*([A-Za-z]+)/.exec(statementText);
  return (match?.[1] ?? "").toUpperCase();
}

/**
 * Rule 2 — reject any `*` that is not the sole argument of `COUNT(`.
 * Deliberately NOT a regex over the projection clause: that shape cannot
 * catch a qualified `t.*`, and it misses `*` entirely inside a subquery.
 * Every `*` in the lexed statement is inspected on its own, in isolation
 * from paren depth — a `*` inside a subquery is still a `*` — and is
 * allowed ONLY when its nearest non-whitespace neighbours are `COUNT(` on
 * the left and `)` on the right.
 *
 * Accepted cost, stated as a decision, not an oversight: `SELECT a * b`
 * (arithmetic multiplication) is rejected too, because it has exactly the
 * same shape — a bare `*` with no enclosing `COUNT(`. Real diagnostic
 * queries needing arithmetic `*` often enough that operators route around
 * the guard is the stated trigger to re-weigh a SQL-parser dependency
 * against this package's `dependencies: {}`.
 */
function findDisallowedStar(statementText: string): boolean {
  const countKeyword = "COUNT(";
  for (let i = 0; i < statementText.length; i += 1) {
    if (statementText[i] !== "*") {
      continue;
    }
    let left = i - 1;
    while (left >= 0 && /\s/.test(statementText[left]!)) {
      left -= 1;
    }
    let right = i + 1;
    while (right < statementText.length && /\s/.test(statementText[right]!)) {
      right += 1;
    }
    const precedingWindow = statementText.slice(Math.max(0, left - countKeyword.length + 1), left + 1);
    const precededByCount = precedingWindow.toUpperCase() === countKeyword;
    const followedByCloseParen = statementText[right] === ")";
    if (!(precededByCount && followedByCloseParen)) {
      return true;
    }
  }
  return false;
}

const EXFILTRATION_FORMS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "INTO OUTFILE", pattern: /INTO\s+OUTFILE/i },
  { label: "INTO DUMPFILE", pattern: /INTO\s+DUMPFILE/i },
  { label: "LOAD_FILE(", pattern: /LOAD_FILE\s*\(/i },
];

function findExfiltrationForm(statementText: string): string | undefined {
  for (const { label, pattern } of EXFILTRATION_FORMS) {
    if (pattern.test(statementText)) {
      return label;
    }
  }
  return undefined;
}

// `LIMIT n` | `LIMIT n, m` (m is the row count) | `LIMIT n OFFSET m` (n is
// the row count) — anchored to the END of the (already depth-0-located)
// tail, so trailing garbage after a recognizable LIMIT clause fails closed
// rather than being silently ignored.
const TRAILING_LIMIT_PATTERN = /^LIMIT\s+(\d+)\s*(?:,\s*(\d+))?(?:\s+OFFSET\s+\d+)?\s*$/i;

function findTopLevelTrailingLimitIndex(statementText: string, depths: readonly number[]): number | undefined {
  const matches = [...statementText.matchAll(/\bLIMIT\b/gi)];
  for (let k = matches.length - 1; k >= 0; k -= 1) {
    const index = matches[k]?.index;
    if (index !== undefined && depths[index] === 0) {
      return index;
    }
  }
  return undefined;
}

type LimitDecision =
  | { readonly ok: true; readonly action: "inject" }
  | { readonly ok: true; readonly action: "keep" }
  | GuardRejection;

function evaluateSelectLimit(statementText: string, depths: readonly number[], rowCap: number): LimitDecision {
  const limitIndex = findTopLevelTrailingLimitIndex(statementText, depths);
  if (limitIndex === undefined) {
    return { ok: true, action: "inject" };
  }

  const tail = statementText.slice(limitIndex).trim();
  const match = TRAILING_LIMIT_PATTERN.exec(tail);
  if (!match) {
    return reject(
      "Query's LIMIT clause could not be parsed as a trailing \"LIMIT n\", \"LIMIT n, m\", or \"LIMIT n OFFSET m\" form.",
    );
  }

  const first = Number(match[1]);
  const second = match[2] !== undefined ? Number(match[2]) : undefined;
  // `LIMIT n, m` → m is the row count (n is the offset); both other forms
  // carry the row count in the first captured number.
  const rowCount = second ?? first;

  if (rowCount > rowCap) {
    return reject(
      `Query's LIMIT (${rowCount}) exceeds the configured row cap of ${rowCap}; lower the LIMIT or narrow the query.`,
    );
  }
  return { ok: true, action: "keep" };
}

export function guardQuery(rawQuery: string, options: { readonly rowCap: number }): GuardResult {
  const lexed = lex(rawQuery);

  // Rule 0, and it has to come first. Every rule below reads
  // `lexed.stripped`, but the value branded and handed to `execFile` is the
  // RAW query — so any rule that relies on stripping is only as strong as
  // the assumption that what was stripped is inert. For a comment that
  // assumption is false: MySQL and MariaDB execute `/*!NNNNN … */` version
  // comments as SQL. `SELECT 1 /*!50000 , 2 */` passed every rule below and
  // returned two columns from a live database.
  //
  // Stripping cannot be made safe here; only refusing can. A comment has no
  // legitimate purpose in a one-shot diagnostic query, so it costs a caller
  // nothing.
  if (lexed.hasComment) {
    return reject(
      "Query contains a comment, which is never allowed: MySQL executes " +
        '"/*!…*/" version comments as SQL, so a comment cannot be safely ' +
        "ignored. Remove it and retry.",
    );
  }

  if (lexed.statements.length === 0) {
    return reject("Query must contain exactly one statement; none was found.");
  }
  if (lexed.statements.length > 1) {
    return reject("Query contains more than one statement; only a single read-only statement is allowed.");
  }

  const statementText = lexed.stripped;
  const verb = leadingVerb(statementText);
  if (!isReadOnlyLeadingVerb(verb)) {
    return reject(
      `Query must begin with one of ${READ_ONLY_LEADING_VERBS.join(", ")}; found "${verb.length > 0 ? verb : "(empty)"}".`,
    );
  }

  if (findDisallowedStar(statementText)) {
    return reject(
      'Query contains "*" outside of COUNT(*); name the columns explicitly, or use COUNT(*) to count rows. ' +
        "This also rejects arithmetic forms like `a * b` — a deliberate, fail-closed over-rejection.",
    );
  }

  const exfilForm = findExfiltrationForm(statementText);
  if (exfilForm !== undefined) {
    return reject(`Query contains "${exfilForm}", which can write to a server-side file and is never allowed.`);
  }

  if (verb !== "SELECT") {
    // SHOW/DESCRIBE/DESC/EXPLAIN take no injected LIMIT — no meaningful one
    // exists; they are bounded by schema size and maxOutputBytes alone.
    return { ok: true, query: brand(rawQuery) };
  }

  const limitDecision = evaluateSelectLimit(statementText, lexed.depths, options.rowCap);
  if (!limitDecision.ok) {
    return limitDecision;
  }
  const finalQuery = limitDecision.action === "inject" ? `${rawQuery.trimEnd()} LIMIT ${options.rowCap}` : rawQuery;
  return { ok: true, query: brand(finalQuery) };
}
