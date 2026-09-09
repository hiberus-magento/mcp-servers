// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Template test (server-manifest spec, "Server Template Scaffold" — "a
// minimal, working MCP server package skeleton ... a template test").
// Proves the read-echo example tool's handler logic in isolation, without
// spawning a real subprocess through the built bundle — the conformance
// suite (mcp-testing) is what proves the built artifact end-to-end.
import { describe, expect, it } from "vitest";
import { readEchoTool } from "./read-echo.js";

describe("read-echo template tool", () => {
  it("echoes the message argument back as the tool result", async () => {
    const result = await readEchoTool.invoke({ message: "hello-from-template" }, {});
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "hello-from-template" }]);
  });
});
