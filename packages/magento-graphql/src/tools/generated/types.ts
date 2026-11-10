// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import type { z } from "zod";
import type { WriteEffect } from "../graphql-tool.js";

/** One operation of the schema, as `scripts/gen-graphql-tools.mjs` emits it. */
export interface GeneratedOperation {
  readonly name: `magentographql_${string}`;
  /** The GraphQL field name, e.g. `setShippingAddressesOnCart`. */
  readonly operation: string;
  readonly kind: "query" | "mutation";
  readonly group: string;
  readonly effect: "read" | WriteEffect;
  readonly description: string;
  /** One operation, fixed text; every argument is a variable. */
  readonly document: string;
  /** A thunk, so a server that loads a few groups builds only their schemas. */
  readonly input: () => z.ZodObject;
}
