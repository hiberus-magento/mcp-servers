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
//   - no `SELECT *` (name the columns), but `COUNT(*)` and `a * b` are fine;
//   - no INTO (files, variables), FOR UPDATE / LOCK, user variables, PROCEDURE, and the functions that read files,
//     take locks or stall the server (SLEEP, BENCHMARK, LOAD_FILE, GET_LOCK, ...);
//   - never the tables that hold credentials (administrators, OAuth tokens, integrations) or the `mysql` schema;
//   - a read always carries a LIMIT within the cap (added when missing); an UPDATE or DELETE always has a WHERE.
//
// This reduces what an agent can do; it is not the security boundary. The boundary is the database user's grants
// and the READ ONLY session the driver opens, which hold even if a rule here has a hole.
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

/** Tables whose rows are credentials or the means to get them. Lower-case, unqualified. */
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
]);

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
    if (ch === "'" || ch === '"' || ch === "`") {
      const start = i;
      i += 1;
      let value = "";
      for (;;) {
        if (i >= sql.length) {
          throw new SqlGuardError("the statement has an unterminated quote");
        }
        const c = sql[i] as string;
        if (c === "\\" && ch !== "`") {
          value += sql.slice(i, i + 2);
          i += 2;
          continue;
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
    if (token.kind === "word" || token.kind === "ident") {
      const name = token.text.toLowerCase();
      if (SENSITIVE_TABLES.has(name)) {
        throw new SqlGuardError(`the table ${name} holds credentials and cannot be queried`);
      }
      const next = tokens[index + 1];
      if (name === "mysql" && next?.kind === "punct" && next.text === ".") {
        throw new SqlGuardError("the mysql schema holds the server's accounts and cannot be queried");
      }
    }
  }
}

function checkStars(tokens: readonly Token[]): void {
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "punct" || token.text !== "*") continue;
    const previous = tokens[index - 1];
    const startsAColumnList = previous === undefined || (previous.kind === "word" && (previous.text === "SELECT" || previous.text === "DISTINCT")) || (previous.kind === "punct" && (previous.text === "," || previous.text === "."));
    if (startsAColumnList) {
      throw new SqlGuardError("name the columns you want instead of * (a table may hold columns you should not read); COUNT(*) is fine");
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
  const operands: Token[] = [];
  for (let i = limitIndex + 1; i < tokens.length; i += 1) {
    const t = tokens[i] as Token;
    if (t.kind === "word" && t.text === "OFFSET") {
      break;
    }
    if (t.kind === "punct" && t.text === ",") {
      continue;
    }
    operands.push(t);
  }
  if (operands.length === 0 || operands.length > 2 || operands.some((t) => t.kind !== "number")) {
    throw new SqlGuardError("LIMIT must be a literal number (or offset, number); a ? placeholder or an expression cannot be checked against the cap");
  }
  const count = Number((operands[operands.length - 1] as Token).text);
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
