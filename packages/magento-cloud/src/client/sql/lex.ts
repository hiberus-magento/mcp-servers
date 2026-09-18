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
 * never be smuggled in through a literal.
 *
 * Stripping is sufficient for a LITERAL, whose content is inert data on the
 * wire. It is NOT sufficient for a COMMENT: `guard.ts` brands and sends the
 * RAW query, and MySQL/MariaDB EXECUTE version comments (`/*!NNNNN … *' + '/`)
 * as real SQL. Anything inside one would therefore be analysed as absent
 * and run anyway — proven against a live database, where
 * `SELECT 1 /*!50000 , 2 *' + '/` returned two columns.
 *
 * So a removed comment is REPORTED, not silently absorbed, and `guard.ts`
 * turns that report into a rejection. Detection stays here, in the one
 * place that decides what a comment is, so a literal containing `--` or
 * `/*` is still data rather than a false positive.
 */
function stripLiteralsAndComments(raw: string): { readonly stripped: string; readonly hasComment: boolean } {
  let out = "";
  let hasComment = false;
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
      hasComment = true;
      while (i < n && raw[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (ch === "/" && raw[i + 1] === "*") {
      hasComment = true;
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
  return { stripped: out, hasComment };
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
  /**
   * Whether a comment was removed. True for every comment form, including
   * MySQL's executable `/*!NNNNN … *' + '/` version comments — the lexer does
   * not distinguish them, because a caller has no legitimate reason to send
   * any comment through a diagnostic tool and telling the two apart is a
   * worse bet than refusing both.
   */
  readonly hasComment: boolean;
}

export function lex(rawQuery: string): LexedQuery {
  const { stripped, hasComment } = stripLiteralsAndComments(rawQuery);
  const depths = computeDepths(stripped);
  const statements = splitTopLevelStatements(stripped, depths);
  return { stripped, depths, statements, hasComment };
}
