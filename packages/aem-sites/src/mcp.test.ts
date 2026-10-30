// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// aem-sites-mcp spec: "Ten-Tool Surface", "Credentials Never Reach the
// Model" and "One Bearer Token per Environment", driven through the tool
// objects `mcp.ts` registers (the stdio wiring itself is covered by the
// conformance suite).
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { createPlanStore } from "./confirm/plan-store.js";
import { createAuthorDouble, SYNTHETIC_AEM_AUTHOR, SYNTHETIC_ROOT, SYNTHETIC_TOKEN } from "./testing/author-double.js";
import { createAemTools, redactResult, type AemRuntime } from "./tools/aem-tools.js";
import type { RouteTable } from "./testing/fetch-double.js";
import type { StoredPlan } from "./tools/plan-builder.js";

const EXPECTED: Record<string, readonly [boolean, boolean, boolean]> = {
  aem_list_environments: [true, false, true],
  aem_check_auth: [true, false, true],
  aem_list_pages: [true, false, true],
  aem_get_page: [true, false, true],
  aem_get_replication_status: [true, false, true],
  aem_get_sheet: [true, false, true],
  aem_list_templates: [true, false, true],
  aem_get_page_tree: [true, false, true],
  aem_plan: [true, false, true],
  aem_apply: [false, true, false],
};

function toolsOver(routes: RouteTable, variables: Record<string, string> = {}) {
  const double = createAuthorDouble(routes);
  const runtime: AemRuntime = {
    config: parseConfig({ AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_WRITE_ROOTS: SYNTHETIC_ROOT, ...variables }),
    clientFor: () => double.client,
    store: createPlanStore<StoredPlan>({ now: () => 0 }),
    now: () => 0,
    sleep: async () => undefined,
    tokenSource: () => "file",
  };
  const tools = createAemTools({ getRuntime: () => runtime });
  const call = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (tool === undefined) {
      throw new Error(name);
    }
    const result = redactResult(await tool.invoke(args, {}));
    return JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;
  };
  return { tools, call, double };
}

describe("tool surface", () => {
  const { tools } = toolsOver({});

  it("exposes exactly the ten tools with their annotation triples", () => {
    expect(Object.fromEntries(tools.map((t) => [t.name, [t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint]]))).toEqual(EXPECTED);
  });

  it("aem_apply is the only tool that is not read-only", () => {
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(["aem_apply"]);
  });

  it("every description says when to use the tool", () => {
    for (const tool of tools) {
      expect(tool.description, tool.name).toMatch(/^Use this/);
    }
  });

  it("aem_apply accepts a token and echoes only — no operation can be restated", () => {
    const apply = tools.find((t) => t.name === "aem_apply");
    expect(Object.keys(apply?.inputSchema.shape ?? {}).sort()).toEqual(["confirmTarget", "env", "kind", "token"]);
  });
});

describe("reads", () => {
  it("aem_get_page refuses paths outside site content", async () => {
    const { tools } = toolsOver({});
    const tool = tools.find((t) => t.name === "aem_get_page");
    await expect(tool?.invoke({ env: "stage", path: "/home/users/x" }, {})).rejects.toThrow(/reads are limited to site content/);
  });

  it("aem_list_environments never returns a token", async () => {
    const { call } = toolsOver({});
    const result = await call("aem_list_environments", {});
    expect(result).toMatchObject({ environments: [{ env: "stage", origin: SYNTHETIC_AEM_AUTHOR, protected: false, token: "file", tokenVariable: "AEM_TOKEN_STAGE" }] });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_TOKEN);
  });

  it("aem_check_auth reports an expired token with the remedy and never the token", async () => {
    const { call } = toolsOver({ "GET /bin/querybuilder.json?path=%2Fcontent%2Facme-demo-site-eu&type=cq%3APage&p.limit=1": { status: 401 } });
    const result = await call("aem_check_auth", { env: "stage" });
    expect(result).toEqual({ env: "stage", verdict: "token-expired-or-invalid", status: 401, remedy: "hiberus-aem-sites auth token set --env stage" });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_TOKEN);
  });

  it("a read answered by the login page comes back as an auth answer, not a crash", async () => {
    const page = `${SYNTHETIC_ROOT}/en`;
    const { call } = toolsOver({ [`GET ${page}/jcr:content.1.json`]: { status: 302, headers: { location: "https://login.example-domain.invalid" } } });
    expect(await call("aem_get_page", { env: "stage", path: page })).toMatchObject({ status: "auth-error", reason: "redirected-to-login" });
  });
});

describe("redaction", () => {
  it("redacts a bearer that somehow reached a tool result", () => {
    const result = redactResult({ content: [{ type: "text", text: `{"h":"Authorization: Bearer ${SYNTHETIC_TOKEN}"}` }] });
    expect(result.content[0]?.text).not.toContain(SYNTHETIC_TOKEN);
  });
});

describe("aem_plan input schema", () => {
  const { tools } = toolsOver({});
  const plan = tools.find((t) => t.name === "aem_plan");

  it("rejects a field a kind does not take", async () => {
    await expect(plan?.invoke({ env: "stage", operation: { kind: "page.delete", path: `${SYNTHETIC_ROOT}/en`, force: true } }, {})).rejects.toThrow();
  });

  it("rejects more than 100 paths", async () => {
    const paths = Array.from({ length: 101 }, (_, i) => `${SYNTHETIC_ROOT}/p${i}`);
    await expect(plan?.invoke({ env: "stage", operation: { kind: "page.publish", paths, target: "publish" } }, {})).rejects.toThrow();
  });
});
