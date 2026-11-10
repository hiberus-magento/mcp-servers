// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Turns the generated operations (`generated/schema-tools.ts`) into tools, through the same factory as the
// hand-written ones, so they get the same guarantees: strict inputs, the operation kind of the fixed document
// checked when the tool is built, annotations from the effect, retry for queries only, the unverified marker.
import { context, contextOf } from "./inputs.js";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { GENERATED_OPERATIONS } from "./generated/schema-tools.js";

/** The groups the generated operations belong to. */
export const GENERATED_GROUP_NAMES: readonly string[] = [...new Set(GENERATED_OPERATIONS.map((o) => o.group))];

export function generatedTools(group: string): (factory: ToolFactory) => readonly MagentoGraphqlTool[] {
  return ({ readTool, writeTool }) =>
    GENERATED_OPERATIONS.filter((o) => o.group === group).map((o) => {
      const spec = {
        name: o.name,
        description: o.description,
        input: o.input().extend({ ...context }).strict(),
        document: o.document,
        pick: o.operation,
        // The arguments ARE the variables, under the schema's own names; store and currency are headers.
        variables: (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([key]) => key !== "store" && key !== "currency")),
        context: contextOf,
      };
      return o.kind === "query" ? readTool(spec) : writeTool({ ...spec, effect: o.effect === "read" ? "action" : o.effect });
    });
}
