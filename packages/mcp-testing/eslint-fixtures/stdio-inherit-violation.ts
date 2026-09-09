// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture (eslint.config.js, fd-1 hazard boundary):
// `stdio: "inherit"` hands a spawned child this process's raw file
// descriptors, bypassing the stdout guard. Asserted against by
// `../eslint-fixtures.test.ts`.
import { spawn } from "node:child_process";

spawn("node", ["-e", "1"], { stdio: "inherit" });
