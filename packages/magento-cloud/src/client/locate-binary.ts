// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Resolves the real `magento-cloud` binary's absolute path BEFORE any
// process is spawned (design.md, Decision 2). `CommandSpec.bin` is already
// documented "Resolved absolute at registration time"
// (`packages/mcp-core/src/exec/command-spec.ts:17`); this is what satisfies
// that contract for a third-party CLI, and it is exactly what closes
// `run-allowlisted.ts:43`'s `ENOENT` trap: `typeof error.code === "number"
// ? error.code : 1` collapses a missing binary to a generic exit 1 with
// empty stderr. Resolving here means that path is never reached for a
// missing binary at all.
//
// Walks an INJECTED `pathEntries: readonly string[]` — NEVER
// `process.env.PATH` — so this module stays pure (magento-cloud-client
// spec, "Client Module Purity"); the caller (the adapter layer) is
// responsible for supplying the real `PATH` entries.
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export function locateBinary(options: { readonly binaryName: string; readonly pathEntries: readonly string[] }): string | undefined {
  for (const dir of options.pathEntries) {
    const candidate = join(dir, options.binaryName);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
