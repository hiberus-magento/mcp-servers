// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 8.1-8.16; magento-cloud-mcp spec). Covers: exactly
// eight tools, asserted by COUNT AND NAME (unit — the runtime proof; the
// built-bundle conformance proof is Phase 9, out of scope here); the
// discriminated `db:sql` request shape rejects an omitted query at runtime
// AND the "size" branch never touches db:sql; credential stripping proven
// on SERIALIZED tool output against the credential-carrying fixture; a
// missing credential produces an immediate isError:true with no spawn; the
// three CLI-failure classifications surface as pairwise-distinguishable
// isError:true results; annotations + descriptions; and — the strongest
// structural proof this batch adds — NO tool exists for ANY forbidden
// operation: ssh, every tunnel:* form, db:dump, or the CLI's own
// api:curl/project:curl/organization:curl/environment:curl passthroughs.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  MagentoCloudCommandFailedError,
  MagentoCloudNotInstalledError,
  MagentoCloudUnsupportedVersionError,
} from "../client/index.js";
import { MissingCredentialError } from "@hiberus-magento/mcp-core";
import {
  createMagentoCloudTools,
  invokeMagentoCloudTool,
  magentocloudQueryDatabaseInput,
  type MagentoCloudRuntime,
} from "./magento-cloud-tools.js";

type ExecFileCallback = (error: (Error & { readonly code?: number | string }) | null, stdout: string, stderr: string) => void;

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

vi.mock("../credential-provider.js", async () => {
  const actual = await vi.importActual<typeof import("../credential-provider.js")>("../credential-provider.js");
  return { ...actual, resolveMagentoCloudCredentialDirect: vi.fn(() => "a-token-value") };
});

import { resolveMagentoCloudCredentialDirect } from "../credential-provider.js";

function mockExecFileOnce(exitCode: number, stdout: string, stderr: string): void {
  execFileMock.mockImplementationOnce((_file: string, _args: readonly string[], _options: Record<string, unknown>, callback: ExecFileCallback) => {
    if (exitCode === 0) {
      callback(null, stdout, stderr);
    } else {
      const error = Object.assign(new Error(`exit ${exitCode}`), { code: exitCode }) as Error & { code: number };
      callback(error, stdout, stderr);
    }
    return new EventEmitter();
  });
}

const RUNTIME: MagentoCloudRuntime = { bin: "/usr/bin/magento-cloud", home: "/home/demo", path: "/usr/bin" };

function buildTools() {
  return createMagentoCloudTools({ getRuntime: () => RUNTIME, now: () => 0 });
}

const EXPECTED_TOOL_NAMES = [
  "magentocloud_auth_status",
  "magentocloud_list_projects",
  "magentocloud_describe_project",
  "magentocloud_list_environments",
  "magentocloud_describe_environment",
  "magentocloud_get_environment_config",
  "magentocloud_get_activities",
  "magentocloud_query_database",
] as const;

describe("createMagentoCloudTools — exactly eight tools", () => {
  it("registers exactly the eight declared names, and no more", () => {
    const tools = buildTools();

    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("every tool is annotated read-only, non-destructive, idempotent, and has a non-empty description", () => {
    for (const tool of buildTools()) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("has no tool for auth token set or the raw relationships CLI-only operations", () => {
    const names = buildTools().map((t) => t.name);
    expect(names).not.toContain("auth_token_set");
    expect(names.some((n) => n.includes("raw"))).toBe(false);
  });

  // The strongest structural proof: no tool exists for ANY forbidden
  // operation. `FORBIDDEN_SUBCOMMANDS` is the client's own closed literal
  // (commands.ts) — this test proves the TOOL surface (not merely the
  // allowlist) exposes nothing that could reach any of them, by checking
  // every tool name and description for the forbidden tokens.
  it("exposes NO tool for ssh, any tunnel:* form, db:dump, or the *:curl passthroughs", () => {
    // Exact forbidden subcommand keys — the same closed literal
    // `commands.ts`'s `FORBIDDEN_SUBCOMMANDS` proves absent from the
    // allowlist. Matched here as EXACT multi-character tokens (never a
    // bare word like "project" or "environment") so this cannot
    // false-positive on a legitimate tool name that merely shares a
    // prefix — "magentocloud_list_projects" is not "project:curl".
    const forbiddenTokens = [
      "tunnel:list",
      "tunnel:open",
      "tunnel:close",
      "tunnel:info",
      "tunnel:single",
      "db:dump",
      "api:curl",
      "project:curl",
      "organization:curl",
      "environment:curl",
    ];
    const tools = buildTools();
    const names = tools.map((t) => t.name);
    const haystacks = tools.map((t) => `${t.name} ${t.description}`.toLowerCase());

    for (const token of forbiddenTokens) {
      expect(names).not.toContain(token);
      for (const haystack of haystacks) {
        expect(haystack).not.toContain(token.toLowerCase());
      }
    }
    // "ssh" and "environment:ssh"/"environment:scp"/"environment:drush"
    // checked as whole-word matches, since "ssh" as a bare substring could
    // theoretically appear inside an unrelated word.
    for (const haystack of haystacks) {
      expect(haystack).not.toMatch(/\bssh\b/);
      expect(haystack).not.toContain("environment:ssh");
      expect(haystack).not.toContain("environment:scp");
      expect(haystack).not.toContain("environment:drush");
    }
    expect(names).not.toContain("ssh");
  });
});

describe("magentocloud_query_database — discriminated request shape", () => {
  it("rejects a { kind: \"select\" } call with no query, before any process is spawned", async () => {
    const [, , , , , , , queryDatabase] = buildTools();

    await expect(
      queryDatabase!.invoke({ projectId: "p", environmentId: "e", request: { kind: "select" } }, {}),
    ).rejects.toThrow();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('{ kind: "size" } wraps db:size and issues no db:sql invocation', async () => {
    mockExecFileOnce(0, "usedMb\tlimitMb\tpercentUsed\n128\t2048\t6.25\n", "");
    const [, , , , , , , queryDatabase] = buildTools();

    const result = await queryDatabase!.invoke({ projectId: "p", environmentId: "e", request: { kind: "size" } }, {});

    expect(result.isError).toBeUndefined();
    const [call] = execFileMock.mock.calls;
    expect(call?.[1]).toContain("db:size");
    expect(call?.[1]).not.toContain("db:sql");
  });

  it("rejects SELECT * before any process is spawned (the guard is reachable from the tool surface)", async () => {
    const [, , , , , , , queryDatabase] = buildTools();

    await expect(
      queryDatabase!.invoke({ projectId: "p", environmentId: "e", request: { kind: "select", query: "SELECT * FROM orders" } }, {}),
    ).rejects.toThrow();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("runs a guarded SELECT through db:sql and reports rowCap/rowsReturned", async () => {
    mockExecFileOnce(0, "entity_id\tsku\n1\tacme-demo-sku\n", "");
    const [, , , , , , , queryDatabase] = buildTools();

    const result = await queryDatabase!.invoke(
      { projectId: "p", environmentId: "e", request: { kind: "select", query: "SELECT entity_id, sku FROM catalog LIMIT 1" } },
      {},
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("acme-demo-sku");
    expect(text).toContain("rowsReturned");
  });

  it("the input schema has no boolean includeSize flag alongside query", () => {
    const parsed = magentocloudQueryDatabaseInput.safeParse({
      projectId: "p",
      environmentId: "e",
      request: { kind: "select", query: "SELECT 1", includeSize: true },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("magentocloud_get_environment_config — credential stripping on SERIALIZED output", () => {
  it("strips username/password from a credential-carrying fixture, proven on the JSON a caller actually receives", async () => {
    mockExecFileOnce(
      0,
      "service\tscheme\thost\tport\tusername\tpassword\ndatabase\tmysql\tdemo-db-host.internal\t3306\tdemo-svc-user\tdemo-svc-password-not-real\n",
      "",
    );
    const [, , , , , getEnvironmentConfig] = buildTools();

    const result = await getEnvironmentConfig!.invoke(
      { projectId: "p", environmentId: "e", include: ["serviceEndpoints"] },
      {},
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/demo-svc-user/);
    expect(text).not.toMatch(/demo-svc-password-not-real/);
    expect(text).not.toMatch(/user|pass|secret|token/i);
    expect(text).toContain("demo-db-host.internal");
  });
});

describe("no configured credential — defer to the CLI's own session", () => {
  // CHANGED DELIBERATELY. This block previously asserted the opposite: that a
  // missing credential produced an error "without ever calling execFile".
  // That test was not wrong; it encoded a decision we are reversing.
  //
  // The spawned CLI receives HOME, so it can find the session `magento-cloud
  // login` leaves in ~/.magento-cloud/. Refusing to spawn meant a user who had
  // already logged in was told to paste a token they did not need. Only
  // `magentocloud_auth_status` tolerated this; the other seven did not.
  //
  // So: always try. If the CLI has a session, it works. If it does not, the
  // CLI says so and our classification turns that into a remedy naming BOTH
  // exits — which is a better message than the one we refused to get.
  it("spawns anyway when no credential is configured, so an existing CLI session is used", async () => {
    vi.mocked(resolveMagentoCloudCredentialDirect).mockImplementationOnce(() => {
      throw new MissingCredentialError({
        domain: "magento-cloud",
        cliCommand: "hiberus-magento-cloud auth token set",
        envVar: "MAGENTO_CLOUD_CLI_TOKEN",
        configPath: "/home/demo/.config/hiberus/magento-cloud.json",
        reason: "not found",
      });
    });
    execFileMock.mockImplementationOnce((_bin, _argv, _opts, cb) => {
      cb(null, "id\ttitle\tregion\nmcproj-demo-0001\tDemo Project\tdemo-region\n", "");
      return new EventEmitter();
    });
    const [, listProjects] = buildTools();

    const result = await listProjects!.invoke({}, {});

    expect(result.isError).toBeUndefined();
    expect(execFileMock).toHaveBeenCalled();
  });

  it("passes no token in the child env when none is configured", async () => {
    vi.mocked(resolveMagentoCloudCredentialDirect).mockImplementationOnce(() => {
      throw new MissingCredentialError({
        domain: "magento-cloud",
        cliCommand: "hiberus-magento-cloud auth token set",
        envVar: "MAGENTO_CLOUD_CLI_TOKEN",
        configPath: "/home/demo/.config/hiberus/magento-cloud.json",
        reason: "not found",
      });
    });
    execFileMock.mockImplementationOnce((_bin, _argv, opts, cb) => {
      expect(opts.env).not.toHaveProperty("MAGENTO_CLOUD_CLI_TOKEN");
      expect(opts.env).toHaveProperty("HOME");
      cb(null, "id\ttitle\tregion\n", "");
      return new EventEmitter();
    });
    const [, listProjects] = buildTools();

    await listProjects!.invoke({}, {});

    expect(execFileMock).toHaveBeenCalled();
  });
});

describe("invokeMagentoCloudTool — the three CLI-failure classifications surface distinctly", () => {
  it("wraps a not-installed failure as isError: true, naming the binary", async () => {
    const tool = { invoke: () => Promise.reject(new MagentoCloudNotInstalledError("magento-cloud")) };

    const result = await invokeMagentoCloudTool(tool, {}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("magento-cloud");
  });

  it("wraps a not-authenticated failure as isError: true, distinct from not-installed", async () => {
    const tool = { invoke: () => Promise.reject(new MagentoCloudCommandFailedError("not-authenticated", "not authenticated — configure MAGENTO_CLOUD_CLI_TOKEN")) };

    const result = await invokeMagentoCloudTool(tool, {}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("MAGENTO_CLOUD_CLI_TOKEN");
    expect(result.content[0]?.text).not.toContain("was not found on the configured PATH");
  });

  it("wraps an unsupported-version failure as isError: true, distinct from the other two", async () => {
    const tool = { invoke: () => Promise.reject(new MagentoCloudUnsupportedVersionError({ minimumVersion: "1.47.0", actualVersion: "0.9.0" })) };

    const result = await invokeMagentoCloudTool(tool, {}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("1.47.0");
  });

  it("re-throws an unrelated error unchanged (never swallows a genuine bug)", async () => {
    const tool = { invoke: () => Promise.reject(new TypeError("boom")) };

    await expect(invokeMagentoCloudTool(tool, {}, {})).rejects.toThrow(TypeError);
  });
});

describe("magentocloud_auth_status — tolerates an absent credential", () => {
  it("reports authenticated: false on a not-authenticated classification, still spawning the process", async () => {
    vi.mocked(resolveMagentoCloudCredentialDirect).mockImplementationOnce(() => {
      throw new MissingCredentialError({
        domain: "magento-cloud",
        cliCommand: "hiberus-magento-cloud auth token set",
        envVar: "MAGENTO_CLOUD_CLI_TOKEN",
        configPath: "/home/demo/.config/hiberus/magento-cloud.json",
        reason: "not found",
      });
    });
    mockExecFileOnce(1, "", "Not logged in.\nTo authenticate non-interactively, configure an API token.");
    const [authStatus] = buildTools();

    const result = await authStatus!.invoke({}, {});

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"authenticated":false');
  });
});
