// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The connected store's schema, as much of it as adapting a fixed document needs (design D12): which root
// operations exist, which fields each type has with the named type they return and the names of their
// arguments, and which types an interface or union can be. Nothing else is kept.
//
// Read from one slim introspection query. Fields are asked for WITH deprecated ones: a deprecated field still
// answers, so a document that selects it must not lose it.

/** Deep enough for Magento's deepest wrapping, `[Type!]!` (NON_NULL > LIST > NON_NULL > named), with one to spare. */
const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }";

export const STORE_SCHEMA_QUERY = `query StoreSchemaForAdaptation { __schema { queryType { name } mutationType { name } types { kind name possibleTypes { name } fields(includeDeprecated: true) { name args { name } type { ${TYPE_REF} } } } } }`;

export interface SchemaField {
  /** The named type the field returns, its NON_NULL and LIST wrappers removed. */
  readonly type: string;
  readonly args: ReadonlySet<string>;
}

export interface SchemaType {
  readonly kind: string;
  /** Absent for a scalar, an enum, an input object and a union. */
  readonly fields?: ReadonlyMap<string, SchemaField>;
  /** The object types an interface or a union can be. */
  readonly possibleTypes?: ReadonlySet<string>;
}

export interface StoreSchema {
  readonly queryType: string;
  readonly mutationType: string | undefined;
  readonly types: ReadonlyMap<string, SchemaType>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nameOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value["name"] === "string" ? value["name"] : undefined;
}

function namedType(ref: unknown): string | undefined {
  let current = ref;
  for (let depth = 0; depth < 8 && isRecord(current); depth += 1) {
    if (typeof current["name"] === "string") return current["name"];
    current = current["ofType"];
  }
  return undefined;
}

/**
 * The schema from an introspection answer's `data` (`{ __schema: ... }`), or `undefined` when it is not one.
 * Accepts the slim answer to `STORE_SCHEMA_QUERY` and a full introspection alike. The server is not trusted to
 * shape it: anything malformed is skipped, and an answer without a query type is no schema at all.
 */
export function readStoreSchema(data: unknown): StoreSchema | undefined {
  const schema = isRecord(data) ? data["__schema"] : undefined;
  if (!isRecord(schema) || !Array.isArray(schema["types"])) return undefined;
  const queryType = nameOf(schema["queryType"]);
  if (queryType === undefined) return undefined;
  const types = new Map<string, SchemaType>();
  for (const raw of schema["types"] as readonly unknown[]) {
    const name = nameOf(raw);
    if (name === undefined || !isRecord(raw)) continue;
    const kind = typeof raw["kind"] === "string" ? raw["kind"] : "";
    let fields: Map<string, SchemaField> | undefined;
    if (Array.isArray(raw["fields"])) {
      fields = new Map();
      for (const field of raw["fields"] as readonly unknown[]) {
        const fieldName = nameOf(field);
        const type = isRecord(field) ? namedType(field["type"]) : undefined;
        if (fieldName === undefined || type === undefined || !isRecord(field)) continue;
        const args = Array.isArray(field["args"]) ? (field["args"] as readonly unknown[]).map(nameOf).filter((a): a is string => a !== undefined) : [];
        fields.set(fieldName, { type, args: new Set(args) });
      }
    }
    const possibleTypes = Array.isArray(raw["possibleTypes"]) ? new Set((raw["possibleTypes"] as readonly unknown[]).map(nameOf).filter((p): p is string => p !== undefined)) : undefined;
    types.set(name, { kind, ...(fields !== undefined ? { fields } : {}), ...(possibleTypes !== undefined ? { possibleTypes } : {}) });
  }
  return { queryType, mutationType: nameOf(schema["mutationType"]), types };
}

/** Whether the store offers this root operation. */
export function offersOperation(schema: StoreSchema, kind: "query" | "mutation", operation: string): boolean {
  const root = kind === "query" ? schema.queryType : schema.mutationType;
  return root !== undefined && schema.types.get(root)?.fields?.has(operation) === true;
}
