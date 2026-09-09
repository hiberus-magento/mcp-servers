// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file is
// never imported by any real code — it exists only so the client-boundary
// `no-restricted-imports` pattern (eslint.config.js) can be proven to fire
// against a deep import into another package's `client/` directory instead
// of its public `client/index.ts` entrypoint (design.md, Decision 6,
// "Client boundary lint, for packages that do not exist yet"). No domain
// package has a `client/` directory yet — this fixture proves the rule
// today, ahead of `eds-package` exercising it for real.
import { internalHelper } from "@hiberus-magento/example-domain/client/internal-helper.js";

export function useInternalHelper(): unknown {
  return internalHelper();
}
