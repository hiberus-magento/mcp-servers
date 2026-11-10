// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The escape hatch and the map: one generic read-only query tool and two schema reads.
//
// `magentographql_query` takes a document from the caller. It is read-only because
// `client.query()` runs the operation guard first and refuses anything that is not exactly one
// query (design D1) — not because of its annotation. The guard also caps the document at 8,000
// characters and selection depth at 12, so an agent cannot send a query that is expensive by
// construction. Whatever the document selects comes back, so use the curated tools where one fits.
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf } from "./inputs.js";

const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";

const LIST_OPERATIONS = "query ListOperations { __schema { queryType { fields { name description } } mutationType { fields { name description } } } }";

const DESCRIBE_TYPE = `
query DescribeType($name: String!) {
  __type(name: $name) {
    kind
    name
    description
    fields { name description args { name description type { ${TYPE_REF} } } type { ${TYPE_REF} } }
    inputFields { name description type { ${TYPE_REF} } }
    enumValues { name description }
    possibleTypes { name }
    interfaces { name }
  }
}`;

export function queryTools({ readTool, dynamicQueryTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    dynamicQueryTool({
      name: "magentographql_query",
      description:
        "Use this to run ONE read-only GraphQL query against the storefront endpoint when no curated tool fits. Mutations and subscriptions are refused before anything is sent; documents over 8,000 characters or nested deeper than 12 selections are refused. Pass values as `variables`, never inside the text. Use magentographql_list_operations and magentographql_describe_type to learn the schema first.",
      input: z
        .object({
          query: z.string().min(1).max(8000).describe("One GraphQL query document."),
          variables: z.record(z.string(), z.unknown()).optional().describe("Variables for the query, as a JSON object."),
          ...context,
        })
        .strict(),
      run: (a, client) => client.query(a.query, { ...(a.variables !== undefined ? { variables: a.variables } : {}), ...(a.store !== undefined ? { store: a.store } : {}), ...(a.currency !== undefined ? { currency: a.currency } : {}) }),
    }),
    readTool({
      name: "magentographql_list_operations",
      description: "Use this to list every query and mutation the storefront schema offers, with descriptions — the map to read before writing a magentographql_query document. Needs introspection, which Magento allows by default.",
      input: z.object({ ...context }).strict(),
      document: LIST_OPERATIONS,
      pick: "__schema",
      context: contextOf,
    }),
    readTool({
      name: "magentographql_describe_type",
      description: "Use this to read one schema type by name — its fields with arguments and types, input fields, enum values or possible types — to learn what a query can select, e.g. ProductInterface or CategoryTree.",
      input: z.object({ type_name: z.string().regex(/^[_A-Za-z][_0-9A-Za-z]{0,127}$/, "a GraphQL type name").describe("The type name, e.g. ProductInterface."), ...context }).strict(),
      document: DESCRIBE_TYPE,
      pick: "__type",
      variables: (a) => ({ name: a.type_name }),
      transform: (value) => value ?? "No type named like this exists in the schema.",
      context: contextOf,
    }),
  ];
}
