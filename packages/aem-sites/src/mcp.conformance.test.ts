// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite (mcp-conformance spec) against the
// BUILT `hiberus-aem-sites-mcp` bundle, with NO `shellOutProbe` supplied —
// AEM Sites is pure-HTTPS and defines no `execFile`-based tool, so the
// domain-independent fd-1 probe alone must be sufficient (mcp-conformance
// spec, "Stdout Purity Assertion": "Domain-independent probe catches
// contamination with no shellOutProbe supplied"). CI-blocking from day one:
// wired as an ordinary `turbo test` step with `dependsOn: ["build",
// "^build"]`, so the bundle always exists before this file runs.
import { fileURLToPath } from "node:url";
import { describeConformance } from "@hiberus-magento/mcp-testing";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

describeConformance({
  serverPath,
  packageDir,
  // Intentionally no `shellOutProbe`: proves the packaging + fd-1 gates
  // pass for a package that ships no decorative exec tool, as for `eds`.
});
