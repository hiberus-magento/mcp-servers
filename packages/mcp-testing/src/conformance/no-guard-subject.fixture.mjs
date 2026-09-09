// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A minimal ES module that installs no stdout guard at all — the negative
// control for `runFd1DivertProbe`'s triangulation test
// (`stdout-purity.test.ts`). `fd1-probe-harness.mjs` in `divert` mode
// `await import()`s this file exactly as it would a real server bundle; since
// this module never calls `createStdioServer()`, the harness's own
// contamination writes land on the REAL stdout unguarded, proving the probe
// fails when a server does not install the mechanism it exists to verify.
export {};
