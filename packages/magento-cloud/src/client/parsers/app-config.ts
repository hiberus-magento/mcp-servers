// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `app:config-get` parser (design.md, Decision 4; tasks.md 6.1-6.2).
// Deliberately NOT built on `../tsv.ts`: the CLI's `app:config-get` output
// is the app's YAML config (`key: value` per line), not a tab-delimited
// read — this fixture's own first line has no `\t` in it at all
// (`app-config.test.ts`'s naive-split contrast proves it). Splits on the
// FIRST `": "` only, since a value itself may legitimately contain a colon
// (e.g. `type: php:8.3`).
export function parseAppConfig(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const separatorIndex = line.indexOf(": ");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 2).trim();
    record[key] = value;
  }
  return record;
}
