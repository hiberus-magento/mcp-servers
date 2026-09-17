// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `environment:relationships` carries LIVE service credentials. Stripping
// is not a formatting step — it is the SHAPE of the only exported type
// (design.md, Decision 7; magento-cloud-client spec, "serviceEndpoints
// Credential Stripping at the Client Boundary"). `ServiceEndpoint` has
// exactly four fields: there is nowhere to put a username or a password.
// Construction IS the stripping — every field is read by NAME from the
// parsed row, never via `{ ...raw }`, so a future column the CLI adds can
// never smuggle a new field through.
import { parseTsvRows, rowsToRecords } from "./tsv.js";

const RELATIONSHIPS_REQUIRED_HEADERS = ["service", "scheme", "host", "port"] as const;

export interface ServiceEndpoint {
  readonly service: string;
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
}

export function parseServiceEndpoints(text: string): readonly ServiceEndpoint[] {
  const rows = parseTsvRows(text);
  const records = rowsToRecords(rows, {
    subcommand: "environment:relationships",
    requiredHeaders: RELATIONSHIPS_REQUIRED_HEADERS,
  });

  return records.map((record) => ({
    service: record.service ?? "",
    scheme: record.scheme ?? "",
    host: record.host ?? "",
    port: Number(record.port ?? "0"),
  }));
}

declare const CliOnly: unique symbol;
/**
 * A branded OPAQUE string, never a typed object — deliberately, so nothing
 * can reach a `password` field through a shared type. This is the ONLY
 * path the raw, unstripped relationships payload takes; it is CLI-only
 * (`cli.ts`'s own unstripped display command), never referenced from
 * `src/tools/**` (proven in `relationships.test.ts`, re-proven once that
 * tree exists at tasks.md 8.10).
 */
export type CliOnlyText = string & { readonly [CliOnly]: true };

export function getRawRelationshipsText(rawStdout: string): CliOnlyText {
  return rawStdout as CliOnlyText;
}
