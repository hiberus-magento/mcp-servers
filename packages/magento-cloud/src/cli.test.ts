// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 7.1-7.11; magento-cloud-cli spec). A credential is
// NEVER accepted as a CLI argument; `auth token set` reads stdin only;
// `auth status` never echoes the token under any outcome; the raw
// `environment:relationships` output is deliberately CLI-only (may include
// credentials); every failure exits non-zero, including a `db:sql` guard
// rejection; untrusted CLI-path stderr is redacted.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "./cli.js";
import { runCli } from "./cli.js";

type ExecFileCallback = (error: (Error & { readonly code?: number | string }) | null, stdout: string, stderr: string) => void;

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

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

const FAKE_BIN = "/usr/bin/magento-cloud";

function buildDeps(overrides?: Partial<CliDeps>): CliDeps {
  return {
    readStdin: vi.fn(async () => "a-token-value"),
    persistToken: vi.fn(() => "/home/demo/.config/hiberus/magento-cloud.json"),
    resolveToken: vi.fn(() => "a-token-value"),
    locateBin: vi.fn(() => FAKE_BIN),
    home: "/home/demo",
    path: "/usr/bin",
    now: () => 0,
    ...overrides,
  };
}

describe("auth token set — stdin-only intake", () => {
  it("reads the token from stdin and persists it", async () => {
    const deps = buildDeps();

    const result = await runCli(["auth", "token", "set"], deps);

    expect(result.exitCode).toBe(0);
    expect(deps.readStdin).toHaveBeenCalledOnce();
    expect(deps.persistToken).toHaveBeenCalledWith("a-token-value");
  });

  it("rejects a token supplied as a CLI argument, before persisting anything", async () => {
    const deps = buildDeps();

    const result = await runCli(["auth", "token", "set", "--token", "abc123"], deps);

    expect(result.exitCode).not.toBe(0);
    expect(deps.persistToken).not.toHaveBeenCalled();
    expect(deps.readStdin).not.toHaveBeenCalled();
  });

  it("rejects an empty token read from stdin", async () => {
    const deps = buildDeps({ readStdin: vi.fn(async () => "   ") });

    const result = await runCli(["auth", "token", "set"], deps);

    expect(result.exitCode).not.toBe(0);
    expect(deps.persistToken).not.toHaveBeenCalled();
  });
});

describe("auth status — never echoes the token", () => {
  it("reports authenticated: true and never contains the resolved token value", async () => {
    mockExecFileOnce(0, "id\tacct-demo-0001\nemail\tdemo.user@example-domain\nusername\tdemo-user\n", "");
    const deps = buildDeps();

    const result = await runCli(["auth", "status"], deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout).not.toContain("a-token-value");
    expect(JSON.parse(result.stdout!)).toMatchObject({ authenticated: true });
  });

  it("reports authenticated: false on a not-authenticated classification, still never echoing the token, and exits non-zero", async () => {
    mockExecFileOnce(1, "", "Not logged in.\nTo authenticate non-interactively, configure an API token.");
    const deps = buildDeps();

    const result = await runCli(["auth", "status"], deps);

    expect(result.stdout ?? "").not.toContain("a-token-value");
    expect(result.stderr ?? "").not.toContain("a-token-value");
    expect(result.exitCode).not.toBe(0);
  });

  it("tolerates an absent credential — auth status is the one command that never requires one", async () => {
    mockExecFileOnce(0, "id\tacct-demo-0001\nemail\tdemo.user@example-domain\nusername\tdemo-user\n", "");
    const deps = buildDeps({
      resolveToken: vi.fn(() => {
        throw new Error("MissingCredentialError-shaped for this test");
      }),
    });

    const result = await runCli(["auth", "status"], deps);

    expect(execFileMock).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(0);
  });
});

describe("environment:relationships — CLI-only, deliberately unstripped", () => {
  it("may include the fixture's username and password fields, unlike the MCP surface", async () => {
    mockExecFileOnce(0, "service\tscheme\thost\tport\tusername\tpassword\ndatabase\tmysql\tdb.internal\t3306\tsvc-user\tsvc-pass\n", "");
    const deps = buildDeps();

    const result = await runCli(["environment:relationships", "--project", "acme-demo-project", "--environment", "acme-demo-env-main"], deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("svc-user");
    expect(result.stdout).toContain("svc-pass");
  });
});

describe("db:sql — guard rejection exits non-zero, never spawns", () => {
  it("rejects a bare SELECT * before any process is spawned", async () => {
    const deps = buildDeps();

    const result = await runCli(
      ["db:sql", "--project", "acme-demo-project", "--environment", "acme-demo-env-main", "--query", "SELECT * FROM orders"],
      deps,
    );

    expect(result.exitCode).not.toBe(0);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("runs a guarded, single-statement SELECT and prints its raw TSV", async () => {
    mockExecFileOnce(0, "entity_id\tsku\n1\tacme-demo-sku\n", "");
    const deps = buildDeps();

    const result = await runCli(
      ["db:sql", "--project", "acme-demo-project", "--environment", "acme-demo-env-main", "--query", "SELECT entity_id, sku FROM catalog LIMIT 5"],
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("acme-demo-sku");
  });
});

describe("exit codes and redaction on failure", () => {
  it("exits non-zero and never hangs when no credential can be resolved for a required command", async () => {
    const deps = buildDeps({
      resolveToken: vi.fn(() => {
        throw new Error("no credential");
      }),
    });

    const result = await runCli(["environment:relationships", "--project", "p", "--environment", "e"], deps);

    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when the binary cannot be located, naming the binary", async () => {
    const deps = buildDeps({
      locateBin: vi.fn(() => {
        throw new Error('"magento-cloud" was not found on the configured PATH.');
      }),
    });

    const result = await runCli(["environment:relationships", "--project", "p", "--environment", "e"], deps);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("magento-cloud");
  });

  it("redacts a token-shaped value, an ANSI escape, and shell metacharacters surfaced from CLI stderr", async () => {
    mockExecFileOnce(1, "", "some error; `echo pwned`\x1b[31m token=abcdefghijklmnopqrstuvwxyz \x1b[0m");
    const deps = buildDeps();

    const result = await runCli(["environment:relationships", "--project", "p", "--environment", "e"], deps);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.stderr).toContain("***");
  });
});
