// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts` (tasks.md
// 9.10-9.11). This file is never imported by any real code — it exists only
// to prove that the client-boundary `no-restricted-imports` pattern
// (`eslint.config.js`, already covering `packages/**/src/**` and
// `packages/*/eslint-fixtures/**`) fires against a deep import into THIS
// package's own `client/` directory instead of its public
// `client/index.ts` entrypoint, same as `mcp-core`'s pre-existing generic
// proof (`packages/mcp-core/eslint-fixtures/deep-client-import-violation.ts`)
// — but exercised for real, in a package that now actually has a `client/`
// directory (design.md's preamble: "the whole domain under `src/client/`,
// whose only public surface is `client/index.ts`").
import { classifyCliFailure } from "../src/client/classify.js";

export function useClassifyCliFailure(): unknown {
  return classifyCliFailure({ exitCode: 1, stderr: "" });
}
