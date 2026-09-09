// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Proves `describeConformance`'s exec-based shell-out probe is genuinely
// OPTIONAL (mcp-conformance spec, "Stdout Purity Assertion"): calling it
// with no `shellOutProbe` against a subject that has no matching tool must
// never attempt the exec probe at all. Runs `describeConformance` for real,
// at module scope — the exact same pattern `conformance.test.ts` uses
// against `packages/fixture-server` — so every `it()` it registers is a
// genuine, independently-reported vitest test.
//
// Before the `if (options.shellOutProbe)` guard exists, this file's exec
// probe `it()` hangs forever (the subject has no `tools/call` handler for
// the default "read-echo" lookup) and times out — the intended RED signal.
// After the guard, that `it()` never registers at all.
import { fileURLToPath } from "node:url";
import { describeConformance } from "./conformance.js";

const packageDir = fileURLToPath(new URL("../../../fixture-server", import.meta.url));
const serverPath = fileURLToPath(new URL("./no-shell-tool-subject.fixture.mjs", import.meta.url));

describeConformance({
  serverPath,
  packageDir,
  // Deliberately omitted: proves the suite does not fall back to a default
  // shell-out probe when the package under test supplies none.
});
