// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A compact way to write a store's schema in a test, answered as Magento answers introspection. Lives beside the
// fetch double, outside `client/`: test-only infrastructure.
//
//   schemaDouble({ Query: { cart: "Cart(cart_id)" }, Cart: { id: "String", items: "CartItem" } })
//
// Each field is `TypeName` or `TypeName(arg1,arg2)`; a type is wrapped in NON_NULL and LIST the way Magento
// wraps many, so a reader that does not unwrap type references fails. A type with a `__possibleTypes` entry
// (comma-separated) is an INTERFACE; the scalars are declared automatically.
import type { RouteResponse } from "./fetch-double.js";

export type CompactSchema = Readonly<Record<string, Readonly<Record<string, string>>>>;

const SCALARS = ["String", "Int", "Float", "Boolean", "ID"];

interface TypeRef {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType: TypeRef | null;
}

const named = (name: string): TypeRef => ({ kind: SCALARS.includes(name) ? "SCALAR" : "OBJECT", name, ofType: null });
const wrapped = (name: string): TypeRef => ({ kind: "NON_NULL", name: null, ofType: { kind: "LIST", name: null, ofType: named(name) } });

/** The `{ __schema }` an introspection query answers with. */
export function introspectionOf(schema: CompactSchema): { readonly __schema: unknown } {
  const types = [
    ...SCALARS.map((name) => ({ kind: "SCALAR", name, fields: null, possibleTypes: null })),
    ...Object.entries(schema).map(([name, fields]) => {
      const possible = fields["__possibleTypes"];
      return {
        kind: possible !== undefined ? "INTERFACE" : "OBJECT",
        name,
        possibleTypes: possible !== undefined ? possible.split(",").map((p) => ({ name: p.trim() })) : null,
        fields: Object.entries(fields)
          .filter(([field]) => field !== "__possibleTypes")
          .map(([field, spec]) => {
            const match = /^(\w+)(?:\(([^)]*)\))?$/.exec(spec);
            if (match === null) throw new Error(`bad field spec ${field}: ${spec}`);
            const args = (match[2] ?? "").split(",").map((a) => a.trim()).filter((a) => a !== "");
            return { name: field, args: args.map((a) => ({ name: a })), type: wrapped(match[1] as string) };
          }),
      };
    }),
  ];
  return { __schema: { queryType: { name: "Query" }, mutationType: schema["Mutation"] !== undefined ? { name: "Mutation" } : null, types } };
}

/** HTTP 200 with that schema as `data`, the answer to the client's introspection request. */
export const schemaDouble = (schema: CompactSchema): RouteResponse => ({ status: 200, body: { data: introspectionOf(schema) } });

/** Whether a recorded request is the client's schema introspection rather than a tool's document. */
export const isIntrospection = (query: string | undefined): boolean => query?.includes("__schema") === true && query.includes("possibleTypes");
