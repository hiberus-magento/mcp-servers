// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The output schema of a read tool, derived from the allowlist it projects through.
//
// A read tool's `structuredContent` is `{ result, provenance }`. `result` is the projected answer, whose fields are
// exactly the tool's allowlist (`shapes.ts`), so the schema is built from that allowlist rather than written by hand
// per tool: the two cannot drift. A field's value is left open (`unknown`): Magento's types vary by version and
// extension, and a schema that guessed them would turn a store's harmless difference into a failed call. What the
// schema does pin is the set of fields, and that `provenance` says where and when the data was read.
//
// The schema is built from the allowlist alone, so the same configuration always produces the same schema (a host
// fingerprints `tools/list`).
import { z } from "zod";
import type { Shape } from "./project.js";

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function objectFor(shape: Shape): z.ZodObject {
  const fields: Record<string, z.ZodType> = {};
  for (const entry of shape) {
    if (typeof entry === "string") {
      fields[entry] = z.unknown().optional();
    } else {
      fields[entry[0]] = valueFor(entry[1]).optional();
    }
  }
  return z.object(fields);
}

/** What `project()` returns for this allowlist: a projected object, a primitive, or a list of either. */
function valueFor(shape: Shape): z.ZodType {
  const element = z.union([objectFor(shape), primitive]);
  return z.union([element, z.array(element)]);
}

/** Where and when the data was read (Kora contract R-3). */
export const provenanceSchema = z.object({
  /** The first request: method and path from `/rest` on, with no host, query string or token. */
  endpoint: z.string(),
  /** Each distinct endpoint, in the order first used, when the tool used more than one (a paged walk counts once). */
  endpoints: z.array(z.string()).optional(),
  api_version: z.literal("V1"),
  /** ISO 8601 UTC, when Magento answered the last request. */
  read_at: z.string(),
  /** The store view the requests addressed, when the URL named one. */
  store_view: z.string().optional(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

export function readOutputSchema(shape: Shape): z.ZodObject {
  return z.object({ result: valueFor(shape), provenance: provenanceSchema });
}
