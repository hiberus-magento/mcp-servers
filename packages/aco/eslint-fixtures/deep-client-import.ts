// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file is
// never imported by any real code — it exists only to prove the
// client-boundary `no-restricted-imports` rule (eslint.config.js) fires
// against a real deep import into THIS package's own `client/` directory,
// rather than only against mcp-core's generic cross-package fixture.
import { classify } from "../src/client/graphql.js";

export function useDeepClientImport(): unknown {
  return classify({ data: {} }, { name: "ListPolicies" });
}
