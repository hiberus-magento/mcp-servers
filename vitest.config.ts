// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Root-level vitest config for `scripts/**/*.test.mjs` — the manifest
// validator, README generator, new-server generator, license-allowlist
// checker, secret scanner, and NOTICES generator. Package-level tests run
// separately through each workspace's own vitest config via turbo (see
// `pnpm test` in the root package.json).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/dist/**", "packages/**"],
  },
});
