// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Reads the operations of one GraphQL document without a GraphQL library (design D2): which
// kind they are, how many there are and how deep the selection goes. It is what lets the generic
// `query` tool exist — that tool is read-only because this guard says the document is a query,
// not because the tool's annotation claims so.
//
// It is a tokenizer, not a parser: it skips comments, strings and block strings, tracks nesting,
// and reads the operation keyword at the top level. A document it cannot read to the end is
// refused, never passed on: an unreadable document is one whose kind nobody can state.
export const MAX_DOCUMENT_CHARS = 8000;
export const MAX_SELECTION_DEPTH = 12;

export type OperationKind = "query" | "mutation" | "subscription";

export interface DocumentInfo {
  /** The most dangerous kind present (subscription, then mutation, then query). */
  readonly kind: OperationKind;
  /** Name of the first named operation, if any. */
  readonly name?: string;
  readonly operations: number;
  /** Deepest selection-set nesting; argument and variable object literals do not count. */
  readonly depth: number;
}

export class OperationGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationGuardError";
  }
}

const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const RANK: Readonly<Record<OperationKind, number>> = { query: 0, mutation: 1, subscription: 2 };

export function inspectDocument(document: string): DocumentInfo {
  if (typeof document !== "string") {
    throw new OperationGuardError("The GraphQL document must be a string.");
  }
  if (document.length > MAX_DOCUMENT_CHARS) {
    throw new OperationGuardError(`The GraphQL document is ${document.length} characters; the limit is ${MAX_DOCUMENT_CHARS}.`);
  }

  const stack: string[] = [];
  let selectionDepth = 0;
  let maxDepth = 0;
  let operations = 0;
  let kind: OperationKind | undefined;
  let name: string | undefined;
  let expectingDefinition = true;
  let awaitingOperationName = false;

  const record = (found: OperationKind): void => {
    operations += 1;
    if (kind === undefined || RANK[found] > RANK[kind]) {
      kind = found;
    }
  };

  let i = 0;
  while (i < document.length) {
    const ch = document.charAt(i);
    if (ch === "#") {
      while (i < document.length && document.charAt(i) !== "\n" && document.charAt(i) !== "\r") i += 1;
      continue;
    }
    if (ch === '"') {
      if (document.startsWith('"""', i)) {
        i += 3;
        for (;;) {
          if (i >= document.length) throw new OperationGuardError("The GraphQL document has an unterminated string.");
          if (document.startsWith('\\"""', i)) i += 4;
          else if (document.startsWith('"""', i)) {
            i += 3;
            break;
          } else i += 1;
        }
      } else {
        i += 1;
        for (;;) {
          const c = document.charAt(i);
          if (i >= document.length || c === "\n" || c === "\r") throw new OperationGuardError("The GraphQL document has an unterminated string.");
          if (c === "\\") i += 2;
          else if (c === '"') {
            i += 1;
            break;
          } else i += 1;
        }
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      if (ch === "{" && stack.length === 0 && expectingDefinition) {
        record("query");
        expectingDefinition = false;
      }
      if (ch === "{" && !stack.includes("(") && !stack.includes("[")) {
        selectionDepth += 1;
        maxDepth = Math.max(maxDepth, selectionDepth);
      }
      stack.push(ch);
      awaitingOperationName = false;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      const open = stack.pop();
      if (open === undefined || CLOSERS[open] !== ch) throw new OperationGuardError("The GraphQL document has unbalanced brackets.");
      if (open === "{" && !stack.includes("(") && !stack.includes("[")) selectionDepth -= 1;
      if (stack.length === 0 && ch === "}") expectingDefinition = true;
      i += 1;
      continue;
    }
    if (NAME_START.test(ch)) {
      let end = i + 1;
      while (end < document.length && NAME_PART.test(document.charAt(end))) end += 1;
      const word = document.slice(i, end);
      if (stack.length === 0) {
        if (expectingDefinition && (word === "query" || word === "mutation" || word === "subscription")) {
          record(word);
          expectingDefinition = false;
          awaitingOperationName = true;
        } else if (expectingDefinition && word === "fragment") {
          expectingDefinition = false;
        } else if (awaitingOperationName) {
          name ??= word;
          awaitingOperationName = false;
        }
      }
      i = end;
      continue;
    }
    i += 1;
  }

  if (stack.length > 0) throw new OperationGuardError("The GraphQL document has unbalanced brackets.");
  if (kind === undefined) {
    throw new OperationGuardError(document.replace(/#[^\n\r]*/g, "").trim() === "" ? "The GraphQL document is empty." : "The GraphQL document has no operation (a fragment alone cannot run).");
  }
  if (maxDepth > MAX_SELECTION_DEPTH) {
    throw new OperationGuardError(`The GraphQL document reaches selection depth ${maxDepth}; the limit is ${MAX_SELECTION_DEPTH}.`);
  }
  return { kind, ...(name !== undefined ? { name } : {}), operations, depth: maxDepth };
}
