// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The scaffolding every tool-module test repeats: a real client over the fetch double, a tool
// factory, and `call` shorthand. Lives beside the fetch double, outside `client/`.
import { SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { createMagentoGraphqlClient } from "../client/index.js";
import { createToolFactory, type MagentoGraphqlTool, type ToolFactory } from "../tools/graphql-tool.js";
import { createFetchDouble, type FetchDouble, type Responder } from "./fetch-double.js";

export interface ToolHarness {
  readonly double: FetchDouble;
  readonly tools: readonly MagentoGraphqlTool[];
  tool(name: string): MagentoGraphqlTool;
  /** Invokes a tool and returns its result: parsed JSON, or the raw text when it is not JSON. Rejects as the tool does. */
  call(name: string, args: unknown): Promise<unknown>;
  /** The variables of the last request sent. */
  lastVariables(): Record<string, unknown> | undefined;
}

export function buildToolHarness(makeTools: (factory: ToolFactory) => readonly MagentoGraphqlTool[], responder: Responder): ToolHarness {
  const double = createFetchDouble(responder);
  const client = createMagentoGraphqlClient({ fetch: double.fetch, now: () => 0, sleep: async () => undefined, baseUrl: SYNTHETIC_MAGENTO_GRAPHQL_URL, getToken: async () => undefined });
  const tools = makeTools(createToolFactory(() => client));
  const tool = (name: string): MagentoGraphqlTool => {
    const found = tools.find((t) => t.name === name);
    if (found === undefined) throw new Error(`no tool named ${name}`);
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
        return text;
      }
    },
    lastVariables: () => double.calls.at(-1)?.request?.variables,
  };
}
