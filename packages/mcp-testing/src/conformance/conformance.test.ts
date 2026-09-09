// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite against `packages/fixture-server`'s
// BUILT bundle. This is the suite every server package must pass
// (mcp-conformance spec) — CI-blocking from day one (wired as a `turbo
// test` step with `dependsOn: ["^build"]`, so the bundle always exists
// before this file runs).
import { fileURLToPath } from "node:url";
import { readOnlyAllowlist } from "@hiberus-magento/fixture-server/src/tools/read-echo.js";
import { DEFAULT_SHELL_OUT_PROBE, describeConformance } from "./conformance.js";

const packageDir = fileURLToPath(new URL("../../../fixture-server", import.meta.url));
const serverPath = fileURLToPath(new URL("../../../fixture-server/dist/server.js", import.meta.url));

describeConformance({
  serverPath,
  packageDir,
  readOnlyIntrospections: [
    {
      toolName: "read-echo",
      registeredCommandKeys: readOnlyAllowlist.listCommandKeys(),
      expectedCommandKeys: ["/bin/echo"],
    },
  ],
  // `shellOutProbe` is optional (mcp-conformance spec, "Stdout Purity
  // Assertion"), but fixture-server DOES have an execFile-based read-echo
  // tool — supply it explicitly to keep this exec-based coverage exactly as
  // it ran before that requirement changed, unweakened.
  shellOutProbe: DEFAULT_SHELL_OUT_PROBE,
});
