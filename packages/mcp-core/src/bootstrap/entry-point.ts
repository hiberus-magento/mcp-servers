// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Whether an ES module is the process entry point (the `require.main === module` of ESM).
//
// The obvious check, `import.meta.url === pathToFileURL(process.argv[1]).href`, is wrong for an installed
// package: npm and npx start a bin through a symlink in `node_modules/.bin`, Node puts that symlink path in
// `process.argv[1]` and resolves `import.meta.url` to the real file, so the two never match and the CLI
// silently does nothing and exits 0. Comparing real paths on both sides works for the direct run and the bin.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntryPoint(importMetaUrl: string, entryPoint: string | undefined = process.argv[1]): boolean {
  if (entryPoint === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entryPoint);
  } catch {
    return false;
  }
}
