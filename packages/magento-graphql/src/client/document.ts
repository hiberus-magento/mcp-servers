// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Reads, trims and prints the FIXED documents this package generates and curates, so one package can run
// against every store version (design D12). Without a GraphQL library (design D2): it reads exactly the
// syntax those documents use — one query or mutation with variable definitions, fields with arguments
// (variables and literals: strings, numbers, enums, lists, objects), directives, nested selection sets,
// inline fragments and `__typename` — and refuses anything else (aliases, fragment spreads, fragment
// definitions, several operations, subscriptions). A document it cannot read is refused, never sent
// half-trimmed. It is never used on the generic query tool's caller-written document.
//
// Trimming against the store's schema removes, and only removes: a field the store's type lacks, an argument
// the store's field lacks, an inline fragment on a type the store lacks, a field (or fragment) whose selection
// set that left empty, and then each variable definition nothing uses any more. Input-object fields inside an
// argument's literal are not trimmed: a store that lacks one answers with its own error.
import type { StoreSchema } from "./schema.js";

export class DocumentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentReadError";
  }
}

export type Value =
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "list"; readonly values: readonly Value[] }
  | { readonly kind: "object"; readonly fields: readonly Argument[] };

export interface Argument {
  readonly name: string;
  readonly value: Value;
}

export interface Directive {
  readonly name: string;
  readonly args: readonly Argument[];
}

export interface Field {
  readonly kind: "field";
  readonly name: string;
  readonly args: readonly Argument[];
  readonly directives: readonly Directive[];
  readonly selections?: readonly Selection[];
}

export interface InlineFragment {
  readonly kind: "inline";
  readonly typeCondition: string;
  readonly directives: readonly Directive[];
  readonly selections: readonly Selection[];
}

export type Selection = Field | InlineFragment;

export interface VariableDefinition {
  readonly name: string;
  readonly type: string;
  readonly defaultValue?: Value;
}

export interface Operation {
  readonly kind: "query" | "mutation";
  readonly name?: string;
  readonly variables: readonly VariableDefinition[];
  readonly selections: readonly Selection[];
}

// ---- reading ------------------------------------------------------------------------------------------------

type Token = { readonly type: "punct"; readonly text: string } | { readonly type: "name"; readonly text: string } | { readonly type: "literal"; readonly text: string };

const PUNCTUATORS = new Set(["!", "$", "(", ")", ":", "=", "@", "[", "]", "{", "}"]);
const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

function tokenize(document: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < document.length) {
    const ch = document.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "," || ch === "﻿") {
      i += 1;
    } else if (ch === "#") {
      while (i < document.length && document.charAt(i) !== "\n" && document.charAt(i) !== "\r") i += 1;
    } else if (document.startsWith("...", i)) {
      tokens.push({ type: "punct", text: "..." });
      i += 3;
    } else if (PUNCTUATORS.has(ch)) {
      tokens.push({ type: "punct", text: ch });
      i += 1;
    } else if (NAME_START.test(ch)) {
      let end = i + 1;
      while (end < document.length && NAME_PART.test(document.charAt(end))) end += 1;
      tokens.push({ type: "name", text: document.slice(i, end) });
      i = end;
    } else if (ch === '"') {
      if (document.startsWith('"""', i)) throw new DocumentReadError("block strings are not supported");
      let end = i + 1;
      for (;;) {
        const c = document.charAt(end);
        if (end >= document.length || c === "\n" || c === "\r") throw new DocumentReadError("unterminated string");
        if (c === "\\") end += 2;
        else if (c === '"') break;
        else end += 1;
      }
      tokens.push({ type: "literal", text: document.slice(i, end + 1) });
      i = end + 1;
    } else {
      const number = NUMBER.exec(document.slice(i));
      if (number === null) throw new DocumentReadError(`unexpected character ${JSON.stringify(ch)}`);
      tokens.push({ type: "literal", text: number[0] });
      i += number[0].length;
    }
  }
  return tokens;
}

class Reader {
  #position = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.#position + offset];
  }

  done(): boolean {
    return this.#position >= this.tokens.length;
  }

  isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.type === "punct" && token.text === text;
  }

  expectPunct(text: string): void {
    if (!this.isPunct(text)) throw new DocumentReadError(`expected ${text}`);
    this.#position += 1;
  }

  name(): string {
    const token = this.peek();
    if (token?.type !== "name") throw new DocumentReadError("expected a name");
    this.#position += 1;
    return token.text;
  }

  next(): Token {
    const token = this.peek();
    if (token === undefined) throw new DocumentReadError("unexpected end of document");
    this.#position += 1;
    return token;
  }
}

function readValue(reader: Reader): Value {
  if (reader.isPunct("$")) {
    reader.expectPunct("$");
    return { kind: "variable", name: reader.name() };
  }
  if (reader.isPunct("[")) {
    reader.expectPunct("[");
    const values: Value[] = [];
    while (!reader.isPunct("]")) values.push(readValue(reader));
    reader.expectPunct("]");
    return { kind: "list", values };
  }
  if (reader.isPunct("{")) {
    reader.expectPunct("{");
    const fields: Argument[] = [];
    while (!reader.isPunct("}")) {
      const name = reader.name();
      reader.expectPunct(":");
      fields.push({ name, value: readValue(reader) });
    }
    reader.expectPunct("}");
    return { kind: "object", fields };
  }
  const token = reader.next();
  if (token.type === "punct") throw new DocumentReadError(`unexpected ${token.text} in a value`);
  return { kind: "literal", text: token.text };
}

function readArguments(reader: Reader): Argument[] {
  if (!reader.isPunct("(")) return [];
  reader.expectPunct("(");
  const args: Argument[] = [];
  while (!reader.isPunct(")")) {
    const name = reader.name();
    reader.expectPunct(":");
    args.push({ name, value: readValue(reader) });
  }
  reader.expectPunct(")");
  return args;
}

function readDirectives(reader: Reader): Directive[] {
  const directives: Directive[] = [];
  while (reader.isPunct("@")) {
    reader.expectPunct("@");
    directives.push({ name: reader.name(), args: readArguments(reader) });
  }
  return directives;
}

function readSelectionSet(reader: Reader): Selection[] {
  reader.expectPunct("{");
  const selections: Selection[] = [];
  while (!reader.isPunct("}")) {
    if (reader.isPunct("...")) {
      reader.expectPunct("...");
      if (reader.peek()?.text !== "on") throw new DocumentReadError("fragment spreads are not supported");
      reader.name();
      const typeCondition = reader.name();
      const directives = readDirectives(reader);
      selections.push({ kind: "inline", typeCondition, directives, selections: readSelectionSet(reader) });
      continue;
    }
    const name = reader.name();
    if (reader.isPunct(":")) throw new DocumentReadError("aliases are not supported");
    const args = readArguments(reader);
    const directives = readDirectives(reader);
    const field: Field = reader.isPunct("{") ? { kind: "field", name, args, directives, selections: readSelectionSet(reader) } : { kind: "field", name, args, directives };
    selections.push(field);
  }
  reader.expectPunct("}");
  if (selections.length === 0) throw new DocumentReadError("empty selection set");
  return selections;
}

function readType(reader: Reader): string {
  let type: string;
  if (reader.isPunct("[")) {
    reader.expectPunct("[");
    type = `[${readType(reader)}]`;
    reader.expectPunct("]");
  } else {
    type = reader.name();
  }
  if (reader.isPunct("!")) {
    reader.expectPunct("!");
    type += "!";
  }
  return type;
}

function readVariableDefinitions(reader: Reader): VariableDefinition[] {
  if (!reader.isPunct("(")) return [];
  reader.expectPunct("(");
  const variables: VariableDefinition[] = [];
  while (!reader.isPunct(")")) {
    reader.expectPunct("$");
    const name = reader.name();
    reader.expectPunct(":");
    const type = readType(reader);
    if (reader.isPunct("=")) {
      reader.expectPunct("=");
      variables.push({ name, type, defaultValue: readValue(reader) });
    } else {
      variables.push({ name, type });
    }
    if (reader.isPunct("@")) throw new DocumentReadError("directives on variables are not supported");
  }
  reader.expectPunct(")");
  return variables;
}

/** Reads one query or mutation of the shape this package's fixed documents have; anything else throws `DocumentReadError`. */
export function readDocument(document: string): Operation {
  const reader = new Reader(tokenize(document));
  let operation: Operation;
  if (reader.isPunct("{")) {
    operation = { kind: "query", variables: [], selections: readSelectionSet(reader) };
  } else {
    const keyword = reader.name();
    if (keyword !== "query" && keyword !== "mutation") throw new DocumentReadError(`${keyword} definitions are not supported`);
    const name = reader.peek()?.type === "name" ? reader.name() : undefined;
    const variables = readVariableDefinitions(reader);
    if (reader.isPunct("@")) throw new DocumentReadError("directives on operations are not supported");
    operation = { kind: keyword, ...(name !== undefined ? { name } : {}), variables, selections: readSelectionSet(reader) };
  }
  if (!reader.done()) throw new DocumentReadError("a document with more than one definition is not supported");
  return operation;
}

// ---- printing -----------------------------------------------------------------------------------------------

function printValue(value: Value): string {
  switch (value.kind) {
    case "variable":
      return `$${value.name}`;
    case "literal":
      return value.text;
    case "list":
      return `[${value.values.map(printValue).join(", ")}]`;
    case "object":
      return `{ ${value.fields.map((f) => `${f.name}: ${printValue(f.value)}`).join(", ")} }`;
  }
}

const printArguments = (args: readonly Argument[]): string => (args.length > 0 ? `(${args.map((a) => `${a.name}: ${printValue(a.value)}`).join(", ")})` : "");
const printDirectives = (directives: readonly Directive[]): string => directives.map((d) => ` @${d.name}${printArguments(d.args)}`).join("");
const printSelections = (selections: readonly Selection[]): string => `{ ${selections.map(printSelection).join(" ")} }`;

function printSelection(selection: Selection): string {
  if (selection.kind === "inline") return `... on ${selection.typeCondition}${printDirectives(selection.directives)} ${printSelections(selection.selections)}`;
  return `${selection.name}${printArguments(selection.args)}${printDirectives(selection.directives)}${selection.selections !== undefined ? ` ${printSelections(selection.selections)}` : ""}`;
}

export function printDocument(operation: Operation): string {
  const variables = operation.variables.map((v) => `$${v.name}: ${v.type}${v.defaultValue !== undefined ? ` = ${printValue(v.defaultValue)}` : ""}`);
  return `${operation.kind}${operation.name !== undefined ? ` ${operation.name}` : ""}${variables.length > 0 ? `(${variables.join(", ")})` : ""} ${printSelections(operation.selections)}`;
}

// ---- trimming -----------------------------------------------------------------------------------------------

/** The root fields an operation selects, introspection fields (`__schema`, `__type`, `__typename`) left out. */
export function rootOperations(operation: Operation): readonly string[] {
  return operation.selections.filter((s): s is Field => s.kind === "field" && !s.name.startsWith("__")).map((s) => s.name);
}

function variablesIn(value: Value, into: Set<string>): void {
  if (value.kind === "variable") into.add(value.name);
  else if (value.kind === "list") for (const v of value.values) variablesIn(v, into);
  else if (value.kind === "object") for (const f of value.fields) variablesIn(f.value, into);
}

function usedVariables(selections: readonly Selection[], into: Set<string>): Set<string> {
  for (const selection of selections) {
    for (const directive of selection.directives) for (const arg of directive.args) variablesIn(arg.value, into);
    if (selection.kind === "field") for (const arg of selection.args) variablesIn(arg.value, into);
    if (selection.selections !== undefined) usedVariables(selection.selections, into);
  }
  return into;
}

/** What to keep: either the store's schema (`typeName` is the type being selected from), or names to drop wherever they appear. */
type Rule = { readonly schema: StoreSchema } | { readonly dropNames: ReadonlySet<string> };

function trimSelections(selections: readonly Selection[], typeName: string | undefined, rule: Rule, removed: string[]): Selection[] {
  const kept: Selection[] = [];
  const type = "schema" in rule && typeName !== undefined ? rule.schema.types.get(typeName) : undefined;
  for (const selection of selections) {
    if (selection.kind === "inline") {
      if ("schema" in rule && !rule.schema.types.has(selection.typeCondition)) {
        removed.push(`... on ${selection.typeCondition}`);
        continue;
      }
      const inner = trimSelections(selection.selections, selection.typeCondition, rule, removed);
      if (inner.length === 0) {
        removed.push(`... on ${selection.typeCondition}`);
        continue;
      }
      kept.push(inner.length === selection.selections.length && inner.every((s, i) => s === selection.selections[i]) ? selection : { ...selection, selections: inner });
      continue;
    }
    // `__typename` exists on every composite type; `__schema` and `__type` are introspection, never trimmed.
    if (selection.name.startsWith("__")) {
      kept.push(selection);
      continue;
    }
    let field: Field = selection;
    let childType: string | undefined;
    if ("schema" in rule) {
      const info = type?.fields?.get(selection.name);
      if (type?.fields !== undefined && info === undefined) {
        removed.push(`${typeName ?? "?"}.${selection.name}`);
        continue;
      }
      if (info !== undefined) {
        childType = info.type;
        const args = selection.args.filter((arg) => info.args.has(arg.name));
        if (args.length !== selection.args.length) {
          for (const arg of selection.args) if (!info.args.has(arg.name)) removed.push(`${typeName ?? "?"}.${selection.name}(${arg.name})`);
          field = { ...field, args };
        }
      }
    } else if (rule.dropNames.has(selection.name)) {
      removed.push(selection.name);
      continue;
    }
    if (field.selections !== undefined) {
      const inner = trimSelections(field.selections, childType, rule, removed);
      if (inner.length === 0) {
        removed.push(`${typeName ?? "?"}.${selection.name}`);
        continue;
      }
      if (inner.length !== field.selections.length || inner.some((s, i) => s !== field.selections?.[i])) field = { ...field, selections: inner };
    }
    kept.push(field);
  }
  return kept;
}

/** Drops the variable definitions nothing uses any more, and names them. */
function withoutUnusedVariables(operation: Operation): { readonly operation: Operation; readonly droppedVariables: readonly string[] } {
  const used = usedVariables(operation.selections, new Set());
  const droppedVariables = operation.variables.filter((v) => !used.has(v.name)).map((v) => v.name);
  return { operation: droppedVariables.length > 0 ? { ...operation, variables: operation.variables.filter((v) => used.has(v.name)) } : operation, droppedVariables };
}

export type TrimOutcome =
  /** Everything the document selects exists: send it as it is, text included. */
  | { readonly status: "unchanged" }
  /** `removed` names what the store lacks; drop `droppedVariables` from the variables sent. */
  | { readonly status: "trimmed"; readonly document: string; readonly removed: readonly string[]; readonly droppedVariables: readonly string[] }
  /** The store's schema has no root operation of that name. */
  | { readonly status: "missing-operation"; readonly operation: string }
  /** The store has the operation, but none of the fields the document selects from it. */
  | { readonly status: "nothing-left"; readonly operation: string };

/** Adapts a fixed document to the store's schema. Throws `DocumentReadError` for a document it cannot read. */
export function trimDocument(document: string, schema: StoreSchema): TrimOutcome {
  const operation = readDocument(document);
  const rootType = operation.kind === "query" ? schema.queryType : schema.mutationType;
  const rootFields = rootType !== undefined ? schema.types.get(rootType)?.fields : undefined;
  for (const name of rootOperations(operation)) {
    if (rootFields?.has(name) !== true) return { status: "missing-operation", operation: name };
  }
  const removed: string[] = [];
  const selections = trimSelections(operation.selections, rootType, { schema }, removed);
  const emptied = rootOperations(operation).find((name) => !selections.some((s) => s.kind === "field" && s.name === name));
  if (emptied !== undefined) return { status: "nothing-left", operation: emptied };
  const pruned = withoutUnusedVariables({ ...operation, selections });
  if (removed.length === 0 && pruned.droppedVariables.length === 0) return { status: "unchanged" };
  return { status: "trimmed", document: printDocument(pruned.operation), removed, droppedVariables: pruned.droppedVariables };
}

/**
 * Without a schema (design D12, fallback): removes every selection of the named fields below the root, the
 * selections that leaves empty and the variables it frees. `undefined` when nothing was removed or when the
 * operation would be left with nothing to select. Throws `DocumentReadError` for a document it cannot read.
 */
export function removeFieldsNamed(document: string, names: ReadonlySet<string>): { readonly document: string; readonly droppedVariables: readonly string[] } | undefined {
  const operation = readDocument(document);
  const removed: string[] = [];
  const selections = operation.selections.map((root) => {
    if (root.kind !== "field" || root.selections === undefined) return root;
    const inner = trimSelections(root.selections, undefined, { dropNames: names }, removed);
    return inner.length === 0 ? undefined : { ...root, selections: inner };
  });
  if (removed.length === 0 || selections.some((s) => s === undefined)) return undefined;
  const pruned = withoutUnusedVariables({ ...operation, selections: selections as Selection[] });
  return { document: printDocument(pruned.operation), droppedVariables: pruned.droppedVariables };
}
