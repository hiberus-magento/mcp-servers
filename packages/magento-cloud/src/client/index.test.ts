// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (design.md's preamble: "the only public surface is
// client/index.ts"). Proves the barrel actually re-exports the primitives
// every adapter (`cli.ts`, `mcp.ts`, `tools/*.ts`) depends on, and that the
// credential-stripping type boundary (design.md, Decision 7) survives the
// barrel: `ServiceEndpoint` has exactly four fields, none of them
// username-/password-shaped, at the exact import path adapters actually use.
import { describe, expect, it } from "vitest";
import * as client from "./index.js";

describe("client/index.ts — the only public surface", () => {
  it("re-exports the allowlist factory and the shared execution path", () => {
    expect(typeof client.createMagentoCloudAllowlist).toBe("function");
    expect(typeof client.executeReadOnlyCommand).toBe("function");
    expect(typeof client.locateBinary).toBe("function");
    expect(typeof client.buildChildEnv).toBe("function");
  });

  it("re-exports every parser an adapter needs, by name", () => {
    expect(typeof client.parseAuthInfo).toBe("function");
    expect(typeof client.parseProjectList).toBe("function");
    expect(typeof client.parseServiceEndpoints).toBe("function");
    expect(typeof client.parseDbSqlRows).toBe("function");
  });

  // CHANGED DELIBERATELY: this text used to be a TSV table. `environment:
  // relationships` rejects `--format` and prints YAML, so the TSV form could
  // only ever have come from an invented fixture.
  it("builds a ServiceEndpoint with exactly the four stripped fields through the barrel path", () => {
    const fixtureText = [
      "database:",
      "    -",
      "        username: some-user",
      "        scheme: mysql",
      "        service: mysql",
      "        host: db.internal",
      "        port: 3306",
      "        password: some-pass",
    ].join("\n");

    const [endpoint] = client.parseServiceEndpoints(fixtureText);

    expect(endpoint).toBeDefined();
    expect(Object.keys(endpoint!).sort()).toEqual(["host", "port", "scheme", "service"]);
    expect(JSON.stringify(endpoint)).not.toMatch(/user|pass/i);
  });
});
