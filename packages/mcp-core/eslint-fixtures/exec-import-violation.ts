// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file is
// never imported by any real code — it exists only so the `exec`/`execSync`/
// `spawnSync` ban (eslint.config.js) can be proven to fire against the
// exact shell-string APIs `mcp-core/src/exec/**` must never use
// (design.md, Decision 4).
import { exec } from "node:child_process";

export function runShellCommand(command: string): void {
  exec(command);
}
