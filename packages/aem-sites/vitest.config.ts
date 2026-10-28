// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Mirrors `packages/eds/vitest.config.ts`: wires `vitest --typecheck` into
// `pnpm test` so any `*.test-d.ts` file is type-checked, never executed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      include: ["**/*.test-d.ts"],
    },
  },
});
