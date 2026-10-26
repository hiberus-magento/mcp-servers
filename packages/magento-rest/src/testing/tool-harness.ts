// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The scaffolding every tool-module test repeats: a real client over the
// fetch double, a tool factory, and `call` / `invoke` shorthands. It lives
// beside the fetch double, outside `client/`, so the purity scan and the
// client-boundary rule never see it. Time is a clock that advances only when
// the rate limiter sleeps, so pacing is exercised without waiting and a frozen
// clock cannot let the limiter spin forever.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { createMagentoRestClient } from "../client/index.js";
import { createToolFactory, type MagentoRestTool, type ToolFactory } from "../tools/rest-tool.js";
import { createFetchDouble, type FetchDouble, type RouteTable } from "./fetch-double.js";

export interface ToolHarness {
  readonly double: FetchDouble;
  readonly tools: readonly MagentoRestTool[];
  /** The tool with this name; throws if the module does not define it. */
  tool(name: string): MagentoRestTool;
  /** Invokes a tool and returns its result: parsed JSON, or the raw text when it is not JSON. Rejects as the tool does. */
  call(name: string, args: unknown): Promise<unknown>;
  /** The paths (with query) of every request sent, in order. */
  paths(): readonly string[];
}

const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };

export function buildToolHarness(makeTools: (factory: ToolFactory) => readonly MagentoRestTool[], routes: RouteTable): ToolHarness {
  const double = createFetchDouble(routes);
  let clock = 0;
  const client = createMagentoRestClient({
    fetch: double.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
    tokenProvider: new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy }),
  });
  const tools = makeTools(createToolFactory(() => client));
  const tool = (name: string): MagentoRestTool => {
    const found = tools.find((t) => t.name === name);
    if (found === undefined) {
      throw new Error(`no tool named ${name}`);
    }
    return found;
  };
  return {
    double,
    tools,
    tool,
    call: async (name, args) => {
      const text = (await tool(name).invoke(args, {})).content[0]?.text ?? "null";
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // `defineTool` emits a string result as-is, without quotes: that is a
        // valid answer for an agent, so it is returned as the string it is.
        return text;
      }
    },
    paths: () => double.calls.map((call) => `${new URL(call.url).pathname}${new URL(call.url).search}`),
  };
}
