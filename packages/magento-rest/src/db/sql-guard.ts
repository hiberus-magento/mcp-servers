// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The SQL guard for the free-form database tools. Pure: text in, a checked statement out, or `SqlGuardError`.
//
// A prefix check ("starts with SELECT") is not a guard: `SELECT 1; DROP TABLE x`, `SELECT ... INTO OUTFILE`,
// `SELECT SLEEP(600)` and a comment that hides the tail all start with SELECT. So the statement is TOKENISED first —
// quotes, backticks and comments understood — and every rule below looks at tokens outside quotes, never at raw text:
//
//   - exactly one statement (a single trailing `;` is dropped);
//   - no comments of any kind (`--`, `#`, `/* */`, including MySQL's executable `/*! */`);
//   - a read is a SELECT; a write is an INSERT, UPDATE or DELETE and nothing else (no DDL, no REPLACE, no LOAD);
//   - a `*` only as `COUNT(*)` or `a * b`, so no `SELECT *` under any modifier (`ALL`, `DISTINCTROW`, ...), and no
//     `TABLE t`, which is `SELECT *` by another name;
//   - no double quotes and no backslash inside a string: where those strings end depends on the server's SQL mode
//     (ANSI_QUOTES, NO_BACKSLASH_ESCAPES), and the guard must read a statement the way the server will;
//   - no INTO (files, variables), locking reads (FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE), user variables,
//     PROCEDURE, and the functions that read files, take locks or stall the server (SLEEP, BENCHMARK, LOAD_FILE, ...);
//   - no `??`: mysql2 formats it as a quoted identifier on the client, so the guard would check a placeholder while
//     the server ran a table name it never saw (the driver now prepares statements on the server, which has no
//     `??`; the refusal stays as a second layer);
//   - never the tables that hold credentials (administrators, OAuth tokens, integrations, sessions, ACL) — also
//     under a Magento table prefix — or the `mysql` schema;
//   - never an identifier named like a credential (`password_hash`, `rp_token`, ...), wherever it is written: result
//     redaction keys on column names, and an alias, an expression or a WHERE clause would get past it;
//   - a read always carries a LIMIT within the cap (added when missing); an UPDATE or DELETE always has a WHERE.
//
// This reduces what an agent can do; it is best-effort and it is not the security boundary. The boundary is the
// database user's grants and the READ ONLY session the driver opens, which hold even if a rule here has a hole.
export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlGuardError";
  }
}

type TokenKind = "word" | "ident" | "string" | "number" | "param" | "punct";

interface Token {
  readonly kind: TokenKind;
  /** Words are upper-cased, identifiers lower-cased and unquoted, strings and punctuation as written. */
  readonly text: string;
  /** Parenthesis depth at which the token sits (0 = the statement itself). */
  readonly depth: number;
  /** Offset of the token's first character in the statement. */
  readonly start: number;
}

/** Tables whose rows are credentials or the means to get them. Lower-case, unqualified, without a table prefix. */
export const SENSITIVE_TABLES: ReadonlySet<string> = new Set([
  "admin_user",
  "admin_passwords",
  "admin_user_session",
  "admin_user_expiration",
  "oauth_consumer",
  "oauth_token",
  "oauth_nonce",
  "oauth_token_request_log",
  "integration",
  "jwt_auth_revoked",
  "login_as_customer",
  "tfa_user_config",
  "session",
  "authorization_rule",
  "authorization_role",
]);

/**
 * Whether a table (or any identifier) names a sensitive table. A name that merely ENDS with a listed one counts too,
 * because Magento's `db.table_prefix` turns `admin_user` into `mg_admin_user`; the cost is refusing an unrelated
 * name that happens to end the same way, which is the side to err on.
 */
export function isSensitiveTable(name: string): boolean {
  const lower = name.toLowerCase();
  for (const table of SENSITIVE_TABLES) {
    if (lower.endsWith(table)) return true;
  }
  return false;
}

/**
 * Names that say a column holds a credential (password, hash, token, secret, key, salt, card data). Shared with
 * `rows.ts`, which redacts the values of such columns, so the guard and the redaction can never disagree on a name.
 * No `g` flag: `test` must not carry state between calls.
 */
export const CREDENTIAL_NAME = /(pass(word|wd)?|hash|token|secret|api_?key|private_?key|salt|cvv|cvc|card_?(number|no)|iban|credential)/i;

const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  "OUTFILE",
  "DUMPFILE",
  "LOAD_FILE",
  "SLEEP",
  "BENCHMARK",
  "GET_LOCK",
  "RELEASE_LOCK",
  "RELEASE_ALL_LOCKS",
  "IS_FREE_LOCK",
  "IS_USED_LOCK",
  "MASTER_POS_WAIT",
  "PROCEDURE",
  "LOCK",
]);

/** Statement verbs that may not appear inside a SELECT, bare. */
const VERBS_NOT_IN_A_READ: ReadonlySet<string> = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE", "DROP", "ALTER", "TRUNCATE", "CREATE", "GRANT", "REVOKE", "CALL", "SET", "LOAD", "RENAME", "HANDLER", "DO", "PREPARE", "EXECUTE", "USE", "KILL", "FLUSH", "RESET", "SHUTDOWN"]);

function tokenize(sql: string): Token[] {
  // Checked on the raw text, before quotes are understood: the driver's formatter treats only '...' and `...` as
  // quoted, so a `??` inside "..." is still replaced, and the identifier it inserts can close that quote.
  if (sql.includes("??")) {
    throw new SqlGuardError("identifier placeholders (??) are not allowed: write table and column names in the statement and pass only values as ? parameters");
  }
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  const push = (kind: TokenKind, text: string, start: number): void => {
    tokens.push({ kind, text, depth, start });
  };
  while (i < sql.length) {
    const ch = sql[i] as string;
    const code = ch.charCodeAt(0);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (code < 32 || code === 127) {
      throw new SqlGuardError("the statement contains a control character");
    }
    if (ch === "#" || (ch === "-" && sql[i + 1] === "-") || (ch === "/" && sql[i + 1] === "*")) {
      throw new SqlGuardError("comments are not allowed (--, # and /* */), including MySQL's executable /*! */ comments");
    }
    // Where a quoted run ends must be the same for the guard and for the server whatever its SQL mode, or a
    // statement the guard read as one string is run as code. A double quote is a string by default and an
    // identifier under ANSI_QUOTES; a backslash escapes the next character unless NO_BACKSLASH_ESCAPES is set. So
    // neither is accepted: strings are single-quoted (a quote inside is doubled), and values belong in ? params.
    if (ch === '"') {
      throw new SqlGuardError("double quotes are not allowed (their meaning depends on the server's SQL mode): write strings in single quotes, or pass values as ? params");
    }
    if (ch === "'" || ch === "`") {
      const start = i;
      i += 1;
      let value = "";
      for (;;) {
        if (i >= sql.length) {
          throw new SqlGuardError("the statement has an unterminated quote");
        }
        const c = sql[i] as string;
        if (c === "\\" && ch === "'") {
          throw new SqlGuardError("a backslash inside a string literal is not allowed (whether it escapes depends on the server's SQL mode): pass the value as a ? param");
        }
        if (c === ch) {
          if (sql[i + 1] === ch) {
            value += ch;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      if (ch === "`") {
        push("ident", value.toLowerCase(), start);
      } else {
        push("string", sql.slice(start, i), start);
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i] as string)) i += 1;
      push("word", sql.slice(start, i).toUpperCase(), start);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < sql.length && /[0-9.]/.test(sql[i] as string)) i += 1;
      push("number", sql.slice(start, i), start);
      continue;
    }
    if (ch === "?") {
      push("param", "?", i);
      i += 1;
      continue;
    }
    if (ch === "@") {
      throw new SqlGuardError("user and system variables (@name) are not allowed");
    }
    if (ch === ":" && sql[i + 1] === "=") {
      throw new SqlGuardError("assignments (:=) are not allowed");
    }
    if (ch === "(") {
      push("punct", ch, i);
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new SqlGuardError("the statement has an unbalanced parenthesis");
      }
      push("punct", ch, i);
      i += 1;
      continue;
    }
    push("punct", ch, i);
    i += 1;
  }
  if (depth !== 0) {
    throw new SqlGuardError("the statement has an unbalanced parenthesis");
  }
  return tokens;
}

/** Tokens of exactly one statement, and the statement text without its trailing semicolon. */
function singleStatement(sql: string): { tokens: Token[]; text: string } {
  const tokens = tokenize(sql);
  const semicolons = tokens.filter((t) => t.kind === "punct" && t.text === ";");
  const last = tokens[tokens.length - 1];
  const onlyTrailing = semicolons.length === 0 || (semicolons.length === 1 && last === semicolons[0]);
  if (!onlyTrailing) {
    throw new SqlGuardError("only one statement is allowed per call (found a ';' in the middle)");
  }
  const body = semicolons.length === 1 ? tokens.slice(0, -1) : tokens;
  if (body.length === 0) {
    throw new SqlGuardError("the statement is empty");
  }
  const text = semicolons.length === 1 && last !== undefined ? sql.slice(0, last.start).trimEnd() : sql.trim();
  return { tokens: body, text };
}

function checkCommon(tokens: readonly Token[]): void {
  for (const [index, token] of tokens.entries()) {
    if (token.kind === "word" && FORBIDDEN_WORDS.has(token.text)) {
      throw new SqlGuardError(`${token.text} is not allowed (it reads files, takes locks or stalls the server)`);
    }
    // `TABLE t` (MySQL 8.0.19+) is `SELECT * FROM t` without the star, also inside a UNION or an INSERT.
    if (token.kind === "word" && token.text === "TABLE") {
      throw new SqlGuardError("TABLE is not allowed (TABLE t reads every column of t, like SELECT *): name the columns in a SELECT");
    }
    if (token.kind === "word" || token.kind === "ident") {
      const name = token.text.toLowerCase();
      if (isSensitiveTable(name)) {
        throw new SqlGuardError(`the table ${name} holds credentials and cannot be queried`);
      }
      if (CREDENTIAL_NAME.test(name)) {
        throw new SqlGuardError(`${name} is named like a credential and cannot be referenced (not in the columns, an expression or a WHERE clause)`);
      }
      const next = tokens[index + 1];
      if (name === "mysql" && next?.kind === "punct" && next.text === ".") {
        throw new SqlGuardError("the mysql schema holds the server's accounts and cannot be queried");
      }
    }
  }
}

/**
 * Words that can never be the operand of a multiplication: SELECT and its modifiers (after which a `*` is a column
 * list), and the clause words around an expression. A denylist of where a column-list star may stand (after SELECT,
 * DISTINCT, a comma) missed `SELECT ALL *` and every other modifier; the star rule is therefore an allowlist, and
 * this set only keeps a keyword from passing as the left operand of `a * b`.
 */
const NOT_AN_OPERAND: ReadonlySet<string> = new Set([
  "SELECT", "ALL", "DISTINCT", "DISTINCTROW", "HIGH_PRIORITY", "STRAIGHT_JOIN", "SQL_SMALL_RESULT", "SQL_BIG_RESULT", "SQL_BUFFER_RESULT", "SQL_NO_CACHE", "SQL_CACHE", "SQL_CALC_FOUND_ROWS",
  "RETURNING", "FROM", "WHERE", "AND", "OR", "XOR", "NOT", "ON", "BY", "AS", "UNION", "EXCEPT", "INTERSECT", "JOIN", "HAVING", "WHEN", "THEN", "ELSE", "IN", "IS", "LIKE", "SET", "VALUES", "INTO", "BETWEEN", "EXISTS", "DIV", "MOD", "USING", "LIMIT", "OFFSET", "WITH",
]);

function isOperand(token: Token | undefined): boolean {
  if (token === undefined) return false;
  if (token.kind === "ident" || token.kind === "number" || token.kind === "param" || token.kind === "string") return true;
  return token.kind === "word" && !NOT_AN_OPERAND.has(token.text);
}

/** A `*` passes only as `COUNT(*)` or as `a * b`; anywhere else it may expand to every column of a table. */
function checkStars(tokens: readonly Token[]): void {
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "punct" || token.text !== "*") continue;
    const before = tokens[index - 2];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const isCountStar = before?.kind === "word" && before.text === "COUNT" && previous?.kind === "punct" && previous.text === "(" && next?.kind === "punct" && next.text === ")";
    const leftOperand = isOperand(previous) || (previous?.kind === "punct" && previous.text === ")");
    const rightOperand = isOperand(next) || (next?.kind === "punct" && (next.text === "(" || next.text === "-" || next.text === "+"));
    if (!isCountStar && !(leftOperand && rightOperand)) {
      throw new SqlGuardError("name the columns you want instead of * (a table may hold columns you should not read); only COUNT(*) and a multiplication (a * b) may use *");
    }
  }
}

export interface GuardedRead {
  readonly sql: string;
}

export function guardReadQuery(sql: string, maxRows: number): GuardedRead {
  const { tokens, text } = singleStatement(sql);
  const first = tokens[0];
  if (first?.kind !== "word" || first.text !== "SELECT") {
    throw new SqlGuardError("only a SELECT is allowed here");
  }
  checkCommon(tokens);
  checkStars(tokens);
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "word") continue;
    if (token.text === "INTO") {
      throw new SqlGuardError("INTO is not allowed (it writes to files or variables)");
    }
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.text === "FOR" && next?.kind === "word" && (next.text === "UPDATE" || next.text === "SHARE")) {
      throw new SqlGuardError("locking reads (FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE) are not allowed");
    }
    const isFunctionCall = next?.kind === "punct" && next.text === "(";
    // REPLACE() and INSERT() are string functions; as statements they are not allowed.
    if (VERBS_NOT_IN_A_READ.has(token.text) && !(previous?.kind === "punct" && previous.text === ".") && !(isFunctionCall && (token.text === "REPLACE" || token.text === "INSERT"))) {
      throw new SqlGuardError(`${token.text} is not allowed in a read query`);
    }
  }

  const limitIndex = tokens.findIndex((t) => t.depth === 0 && t.kind === "word" && t.text === "LIMIT");
  if (limitIndex < 0) {
    return { sql: `${text} LIMIT ${maxRows}` };
  }
  // The tail is matched whole — `n`, `offset, n` or `n OFFSET offset` and nothing after — so a clause appended
  // past the OFFSET (a locking read, a UNION) cannot ride along unchecked.
  const tail = tokens.slice(limitIndex + 1);
  const isNumber = (t: Token | undefined): boolean => t?.kind === "number";
  const separator = tail[1];
  const commaForm = tail.length === 3 && separator?.kind === "punct" && separator.text === ",";
  const offsetForm = tail.length === 3 && separator?.kind === "word" && separator.text === "OFFSET";
  const wellFormed = (tail.length === 1 && isNumber(tail[0])) || ((commaForm || offsetForm) && isNumber(tail[0]) && isNumber(tail[2]));
  if (!wellFormed) {
    throw new SqlGuardError("LIMIT must be a literal number (or offset, number, or number OFFSET offset) and end the statement; a ? placeholder or an expression cannot be checked against the cap");
  }
  const count = Number((commaForm ? tail[2] : tail[0])?.text);
  if (!(count <= maxRows)) {
    throw new SqlGuardError(`LIMIT ${count} is over the cap of ${maxRows} rows per call; lower it or page with OFFSET`);
  }
  return { sql: text };
}

export type WriteKind = "insert" | "update" | "delete";

export interface GuardedWrite {
  readonly sql: string;
  readonly kind: WriteKind;
}

export function guardWriteStatement(sql: string): GuardedWrite {
  const { tokens, text } = singleStatement(sql);
  const first = tokens[0];
  const kind = first?.kind === "word" ? (first.text.toLowerCase() as WriteKind) : undefined;
  if (kind !== "insert" && kind !== "update" && kind !== "delete") {
    throw new SqlGuardError("only INSERT, UPDATE and DELETE are allowed (no SELECT, REPLACE, DDL, LOAD or GRANT)");
  }
  checkCommon(tokens);
  checkStars(tokens);
  if (kind !== "insert") {
    const hasWhere = tokens.some((t) => t.depth === 0 && t.kind === "word" && t.text === "WHERE");
    if (!hasWhere) {
      throw new SqlGuardError(`${kind.toUpperCase()} must have a WHERE clause at the top level of the statement`);
    }
  }
  for (const token of tokens) {
    if (token.kind === "word" && token.text === "INTO" && kind !== "insert") {
      throw new SqlGuardError("INTO is only allowed in an INSERT");
    }
  }
  return { sql: text, kind };
}
