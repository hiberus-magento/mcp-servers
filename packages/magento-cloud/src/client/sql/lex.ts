// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single lexer every `db:sql` guard rule reads (design.md, Decision 5;
// tasks.md 5.1-5.2). Strips `'…'`/`"…"`/`` `…` `` literals (honouring both
// `\'` backslash-escapes and `''` doubled-quote escapes) and `-- `/`#` line
// comments and `/*…*/` block comments, and tracks parenthesis depth over
// the stripped result. Every rule in `guard.ts` reads THIS output, never
// the raw query text directly — an evasion that defeated one rule would
// defeat none of the others silently, because there is only one place that
// decides what counts as a literal, a comment, or a nesting boundary.
const SINGLE_QUOTE = "'";
const DOUBLE_QUOTE = '"';
const BACKTICK = "`";

function isQuoteChar(ch: string | undefined): boolean {
  return ch === SINGLE_QUOTE || ch === DOUBLE_QUOTE || ch === BACKTICK;
}

function isLineCommentStart(raw: string, i: number): boolean {
  if (raw[i] === "#") {
    return true;
  }
  if (raw[i] === "-" && raw[i + 1] === "-") {
    const next = raw[i + 2];
    // MySQL's own rule: `--` starts a comment only when followed by
    // whitespace or end-of-input — otherwise `1--1` (double negation) would
    // be misread as a comment.
    return next === undefined || /\s/.test(next);
  }
  return false;
}

/**
 * Replaces every string/identifier literal's CONTENT with nothing (leaving
 * only the opening/closing quote characters) and removes every comment
 * entirely, so `;`, `*`, and every keyword this module's rules scan for can
 * never be smuggled in through a literal or a comment.
 */
function stripLiteralsAndComments(raw: string): string {
  let out = "";
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i]!;

    if (isQuoteChar(ch)) {
      const quote = ch;
      out += quote + quote;
      i += 1;
      while (i < n) {
        if (raw[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (raw[i] === quote) {
          if (raw[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (isLineCommentStart(raw, i)) {
      while (i < n && raw[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < n && !(raw[i] === "*" && raw[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

/** Depth AT each character index of `stripped` — 0 is top level. Depth
 * cannot go negative on an unbalanced `)`; it clamps at 0 instead, which is
 * the fail-closed direction (a stray `)` never makes something LOOK deeper
 * than it is, only shallower). */
function computeDepths(stripped: string): readonly number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "(") {
      depths.push(depth);
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      depths.push(depth);
      continue;
    }
    depths.push(depth);
  }
  return depths;
}

function splitTopLevelStatements(stripped: string, depths: readonly number[]): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped[i] === ";" && depths[i] === 0) {
      parts.push(stripped.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(stripped.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export interface LexedQuery {
  /** Literal/comment-stripped form of the full raw query. */
  readonly stripped: string;
  /** Paren depth at each character index of `stripped`. */
  readonly depths: readonly number[];
  /** Depth-0 `;`-split, trimmed, non-empty statements. */
  readonly statements: readonly string[];
}

export function lex(rawQuery: string): LexedQuery {
  const stripped = stripLiteralsAndComments(rawQuery);
  const depths = computeDepths(stripped);
  const statements = splitTopLevelStatements(stripped, depths);
  return { stripped, depths, statements };
}
