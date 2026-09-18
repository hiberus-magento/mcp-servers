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
import { MagentoCloudOutputShapeError } from "./errors.js";

export interface ServiceEndpoint {
  readonly service: string;
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
}

/** The only four keys ever read. Nothing else in the entry is looked at, so
 * there is no code path along which a credential could be picked up. */
const ENDPOINT_FIELDS = ["service", "scheme", "host", "port"] as const;
type EndpointField = (typeof ENDPOINT_FIELDS)[number];

/** `    -`, or `    - key: value` — the start of a new relationship entry. */
const SEQUENCE_ITEM = /^(\s*)-(\s|$)/;
/** `key: value`, `key:`, or `- key: value`, capturing indent, key, and value. */
const KEY_LINE = /^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+):(?:\s+(.*))?\s*$/;

function unquote(value: string): string {
  const match = /^'(.*)'$|^"(.*)"$/.exec(value);
  return match ? (match[1] ?? match[2] ?? "") : value;
}

/**
 * `environment:relationships` is NOT a TSV read: it REJECTS `--format`
 * ("The `--format` option does not exist.") and prints YAML, so
 * `../commands.ts` sends it no format flag at all.
 *
 * This is deliberately not a YAML parser. It scans for the four scalars
 * `ServiceEndpoint` is made of and ignores everything else — which is also
 * what keeps design.md's Decision 7 true by construction: `username` and
 * `password` are never READ, not merely never copied.
 *
 * The one assumption it makes about the layout, rather than about key
 * names, is that an entry's own fields sit as scalars at a single
 * indentation level. It therefore refuses to read a `host` nested DEEPER
 * than the entry's own fields (inside a `query:` block, say), and it starts
 * a new entry at a sequence marker, at a container key shallower than the
 * current entry, or when a field it already has is set again. If that
 * assumption is ever wrong, the result is an error naming the keys it did
 * see — never a plausible-looking endpoint pointing somewhere else.
 */
export function parseServiceEndpoints(text: string): readonly ServiceEndpoint[] {
  const endpoints: ServiceEndpoint[] = [];
  const keysSeen: string[] = [];
  let entry: Partial<Record<EndpointField, string>> = {};
  let entryIndent: number | undefined;

  const flush = () => {
    const host = entry.host;
    if (host !== undefined && host.length > 0) {
      // Field by field, by name — never `{ ...entry }`, so a key this scan
      // does not know about cannot reach the result even by accident.
      endpoints.push({
        service: entry.service ?? "",
        scheme: entry.scheme ?? "",
        host,
        port: Number(entry.port ?? "0"),
      });
    }
    entry = {};
    entryIndent = undefined;
  };

  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    if (SEQUENCE_ITEM.test(line)) {
      flush();
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const rawValue = match[3];
    keysSeen.push(key);

    if (rawValue === undefined || rawValue.length === 0) {
      // A container key (`database:`, `query:`). One shallower than the
      // entry being built means that entry has ended.
      if (entryIndent !== undefined && indent < entryIndent) {
        flush();
      }
      continue;
    }
    if (!(ENDPOINT_FIELDS as readonly string[]).includes(key)) {
      continue;
    }
    const field = key as EndpointField;
    if (entryIndent === undefined) {
      entryIndent = indent;
    } else if (indent < entryIndent || (indent === entryIndent && entry[field] !== undefined)) {
      flush();
      entryIndent = indent;
    } else if (indent > entryIndent) {
      // Nested deeper than this entry's own fields — it belongs to some
      // inner block, not to the endpoint.
      continue;
    }
    entry[field] = unquote(rawValue.trim());
  }
  flush();

  // An environment with no relationships prints an empty mapping, and that
  // is a real answer. ANY other output that yielded no endpoint is not: it
  // means this scan did not understand what the CLI printed, and saying
  // "no service endpoints" would be the same silent wrong answer that the
  // TSV reading of this command used to give.
  const body = text.trim();
  const isEmptyOutput = body.length === 0 || body === "{}" || body === "[]";
  if (endpoints.length === 0 && !isEmptyOutput) {
    throw new MagentoCloudOutputShapeError({
      subcommand: "environment:relationships",
      missingHeader: "host",
      headersSeen: keysSeen,
    });
  }
  return endpoints;
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
