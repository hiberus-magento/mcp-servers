// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.3-3.6, 4.5-4.6, 5.4-5.5, 5.15-5.17). Proves the
// allowlist's registered keys match the declared read-only literal exactly,
// that every forbidden entry resolves to nothing, that
// `checkReadOnlyIsolation` genuinely detects contamination (not a no-op),
// every list-/table-shaped argv carries `--format=tsv`, and — the coupling
// test design.md calls out explicitly — that the db:sql spec's own
// `argsSchema` failure means `buildArgv` is NEVER reached, for every named
// guard rejection, not merely the happy path.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { validateArgv } from "@hiberus-magento/mcp-core";
import {
  checkReadOnlyIsolation,
  createMagentoCloudAllowlist,
  DB_SQL_MAX_OUTPUT_BYTES,
  FORBIDDEN_SUBCOMMANDS,
  READ_ONLY_SUBCOMMANDS,
  ROW_CAP,
} from "./commands.js";

const execFileMock = vi.fn(
  (
    _file: string,
    _args: readonly string[],
    _options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, "ok", "");
    return new EventEmitter();
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

const BIN = "/usr/bin/magento-cloud";

describe("createMagentoCloudAllowlist — registered keys match the declared literal exactly", () => {
  it("listCommandKeys() deep-equals READ_ONLY_SUBCOMMANDS mapped to full keys, sorted", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);

    const expectedKeys = READ_ONLY_SUBCOMMANDS.map((subcommand) => [BIN, ...subcommand].join(" ")).sort();

    expect(allowlist.listCommandKeys().sort()).toEqual(expectedKeys);
  });

  it.each(FORBIDDEN_SUBCOMMANDS)("never resolves the forbidden entry: %s", (...subcommand) => {
    const allowlist = createMagentoCloudAllowlist(BIN);

    expect(allowlist.resolve(BIN, subcommand)).toBeUndefined();
  });

  it("never resolves ssh, every tunnel:* form, db:dump, or any of the four *:curl passthroughs", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const forbidden = [
      ["ssh"],
      ["tunnel:list"],
      ["tunnel:open"],
      ["tunnel:close"],
      ["tunnel:info"],
      ["tunnel:single"],
      ["db:dump"],
      ["api:curl"],
      ["project:curl"],
      ["organization:curl"],
      ["environment:curl"],
    ];
    for (const subcommand of forbidden) {
      expect(allowlist.resolve(BIN, subcommand)).toBeUndefined();
    }
  });
});

describe("checkReadOnlyIsolation — positive control", () => {
  it("returns exactly one violation when a contaminated key list is fed in", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const expectedCommandKeys = allowlist.listCommandKeys();
    const contaminatedKeys = [...expectedCommandKeys, `${BIN} db:dump`];

    const violations = checkReadOnlyIsolation({
      registeredCommandKeys: contaminatedKeys,
      expectedCommandKeys,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.commandKey).toBe(`${BIN} db:dump`);
  });

  it("returns no violations when the registered keys exactly match the expected set (contrast case)", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const expectedCommandKeys = allowlist.listCommandKeys();

    const violations = checkReadOnlyIsolation({ registeredCommandKeys: expectedCommandKeys, expectedCommandKeys });

    expect(violations).toEqual([]);
  });
});

const TSV_FORMATTED_SUBCOMMANDS: ReadonlyArray<{
  readonly key: readonly string[];
  readonly args: Record<string, unknown>;
}> = [
  { key: ["auth:info", "--no-auto-login"], args: {} },
  { key: ["project:list"], args: {} },
  { key: ["project:info"], args: { projectId: "acme-demo-project" } },
  { key: ["environment:list"], args: { projectId: "acme-demo-project" } },
  { key: ["environment:info"], args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" } },
  { key: ["activity:list"], args: { projectId: "acme-demo-project" } },
  { key: ["activity:get"], args: { projectId: "acme-demo-project", activityId: "act-demo-0001" } },
  { key: ["variable:list"], args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" } },
  {
    key: ["variable:get"],
    args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main", variableName: "DEMO_FLAG" },
  },
  { key: ["route:list"], args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" } },
  { key: ["service:list"], args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" } },
  { key: ["db:size"], args: { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" } },
  { key: ["subscription:info"], args: { projectId: "acme-demo-project" } },
];

describe("argv builders — every list-/table-shaped read carries --format=tsv", () => {
  it.each(TSV_FORMATTED_SUBCOMMANDS)("$key.0 built argv contains --format=tsv", ({ key, args }) => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, key);
    if (!spec) {
      throw new Error(`expected "${key.join(" ")}" to be registered`);
    }

    const result = validateArgv(spec, args);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("--format=tsv");
      expect(result.value).not.toContain("--format=table");
      expect(result.value).not.toContain("--format=csv");
      expect(result.value).not.toContain("--format=plain");
    }
  });
});

// CHANGED DELIBERATELY: `environment:url` and `environment:relationships`
// used to be in the list above. They do not merely ignore `--format` — they
// REJECT it: `[RuntimeException] The "--format" option does not exist.` Every
// call to either one failed outright, so asserting that they carried
// `--format=tsv` was asserting the bug.
describe("environment:url and environment:relationships REJECT --format entirely", () => {
  it("environment:url asks for --pipe and carries no --format flag", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["environment:url"]);
    if (!spec) throw new Error("expected environment:url to be registered");

    const result = validateArgv(spec, { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("--pipe");
      expect(result.value.some((token) => token.startsWith("--format"))).toBe(false);
    }
  });

  it("environment:relationships carries no --format flag (its default output is YAML)", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["environment:relationships"]);
    if (!spec) throw new Error("expected environment:relationships to be registered");

    const result = validateArgv(spec, { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((token) => token.startsWith("--format"))).toBe(false);
    }
  });
});

describe("app:config-get and activity:log are deliberately excluded from --format=tsv", () => {
  it("app:config-get's built argv carries no --format flag (its output is YAML, not tabular)", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["app:config-get"]);
    if (!spec) throw new Error("expected app:config-get to be registered");

    const result = validateArgv(spec, { projectId: "acme-demo-project", environmentId: "acme-demo-env-main" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((token) => token.startsWith("--format"))).toBe(false);
    }
  });

  it("activity:log's built argv carries no --format flag (its output is plain deployment-log text)", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["activity:log"]);
    if (!spec) throw new Error("expected activity:log to be registered");

    const result = validateArgv(spec, { projectId: "acme-demo-project", activityId: "act-demo-0001" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((token) => token.startsWith("--format"))).toBe(false);
    }
  });
});

describe("db:sql spec — the coupling guarantee (design.md, Decision 5)", () => {
  function dbSqlSpecWithSpy() {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["db:sql"]);
    if (!spec) throw new Error("expected db:sql to be registered");
    const buildArgvSpy = vi.fn(spec.buildArgv);
    return { ...spec, buildArgv: buildArgvSpy } as typeof spec & { buildArgv: typeof buildArgvSpy };
  }

  it("accepts a valid single SELECT ... LIMIT and calls buildArgv exactly once, with --raw and the (possibly rewritten) query", () => {
    const spec = dbSqlSpecWithSpy();

    const result = validateArgv(spec, {
      projectId: "acme-demo-project",
      environmentId: "acme-demo-env-main",
      query: "SELECT id FROM catalog_product_entity LIMIT 10",
    });

    expect(result.ok).toBe(true);
    expect(spec.buildArgv).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value).toContain("--raw");
      expect(result.value).toContain("SELECT id FROM catalog_product_entity LIMIT 10");
    }
  });

  it.each([
    ["UPDATE catalog_product_entity SET sku = 'x'"],
    ["SELECT id FROM t; DROP TABLE t"],
    ["SELECT * FROM catalog_product_entity"],
    ["SELECT t.* FROM catalog_product_entity t"],
    ["SELECT id FROM catalog_product_entity INTO OUTFILE '/tmp/x'"],
    ["SELECT id FROM catalog_product_entity LIMIT 999999999"],
  ])("rejects %s before buildArgv is ever called", (query) => {
    const spec = dbSqlSpecWithSpy();

    const result = validateArgv(spec, { projectId: "acme-demo-project", environmentId: "acme-demo-env-main", query });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("schema-invalid");
    }
    expect(spec.buildArgv).not.toHaveBeenCalled();
  });

  it("injects LIMIT <ROW_CAP> into the CAPTURED argv when the query carries none", () => {
    const spec = dbSqlSpecWithSpy();

    const result = validateArgv(spec, {
      projectId: "acme-demo-project",
      environmentId: "acme-demo-env-main",
      query: "SELECT id FROM catalog_product_entity",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const queryToken = result.value.at(-1);
      expect(queryToken).toContain(`LIMIT ${ROW_CAP}`);
    }
  });

  it("uses the documented, chosen-not-default ROW_CAP and DB_SQL_MAX_OUTPUT_BYTES", () => {
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["db:sql"]);

    expect(spec?.maxOutputBytes).toBe(DB_SQL_MAX_OUTPUT_BYTES);
    expect(ROW_CAP).toBeGreaterThan(0);
  });
});

describe("child-environment / spawn-boundary reuse (design.md, Decision 1 domain side; Decision 2's stdio guarantee)", () => {
  it("every spawned invocation always goes through mcp-core's unmodified runAllowlisted with stdio: 'pipe'", async () => {
    const { runAllowlisted } = await import("@hiberus-magento/mcp-core");
    execFileMock.mockClear();
    const allowlist = createMagentoCloudAllowlist(BIN);
    const spec = allowlist.resolve(BIN, ["project:list"]);
    if (!spec) throw new Error("expected project:list to be registered");
    const validated = validateArgv(spec, {});
    if (!validated.ok) throw new Error("expected validation to succeed");

    await runAllowlisted({ ...spec, env: { MAGENTO_CLOUD_CLI_TOKEN: "demo-token", HOME: "/home/demo", PATH: "/usr/bin" } } as never, validated.value);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const options = execFileMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.stdio).toBe("pipe");
    expect(options.stdio).not.toBe("inherit");
  });
});
