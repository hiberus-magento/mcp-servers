// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file is
// never imported by any real code — it exists only so the SDK-boundary
// `no-restricted-imports` rule (eslint.config.js) can be proven to fire
// against a `server/index.js` deep import, the exact path that pulls
// express/hono/ajv/etc into a bundle (design.md, Decision 1).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function createBannedServer(): Server {
  return new Server({ name: "banned", version: "0.0.0" }, {});
}
