// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Wires `vitest --typecheck` into `pnpm test` (design.md, Decision 3;
// tasks.md 4.3). `*.test-d.ts` files are never executed as runtime tests —
// they exist only to be type-checked, proving `defineTool()`'s compile-time
// annotation enforcement via `@ts-expect-error`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      include: ["**/*.test-d.ts"],
    },
  },
});
