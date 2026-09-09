// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Mirrors `packages/mcp-core/vitest.config.ts`: wires `vitest --typecheck`
// into `pnpm test` so `*.test-d.ts` files are type-checked (never executed
// as runtime tests) — used by `errors.test-d.ts`, `retry.test-d.ts`, and
// later `mcp.test-d.ts` (Phase 7) for the reindex hazard gate.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      include: ["**/*.test-d.ts"],
    },
  },
});
