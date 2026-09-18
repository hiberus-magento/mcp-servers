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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * The checked-in fixtures are what the real CLI printed. A test that made up
 * its own stdout would be testing the shape this code already expects — the
 * exact failure mode that let seven of eight tools ship broken against the
 * real CLI — so the `environment:url` and `activity:log` cases below feed the
 * REAL fixture bytes and derive their expectations from those bytes
 * independently of the parser under test.
 */
function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../test/fake-bin/fixtures/${name}`, import.meta.url)), "utf8");
}

function buildTools() {
  return createMagentoCloudTools({ getRuntime: () => RUNTIME, now: () => 0 });
}

/** By name, not by position: the surface is no longer a fixed-length tuple. */
function toolNamed(name: string) {
  const tool = buildTools().find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`expected a tool named "${name}" to be registered`);
  }
  return tool;
}

// CHANGED DELIBERATELY: eight became nine. `activity:log` was built,
// allowlisted and fixtured, and then reachable from no tool at all — the
// deployment log is the one thing an operator actually wants after
// `magentocloud_get_activities` says an activity failed.
const EXPECTED_TOOL_NAMES = [
  "magentocloud_auth_status",
  "magentocloud_list_projects",
  "magentocloud_describe_project",
  "magentocloud_list_environments",
  "magentocloud_describe_environment",
  "magentocloud_get_environment_config",
  "magentocloud_get_activities",
  "magentocloud_get_activity_log",
  "magentocloud_query_database",
] as const;

describe("createMagentoCloudTools — exactly nine tools", () => {
  it("registers exactly the nine declared names, and no more", () => {
    const tools = buildTools();

    expect(tools).toHaveLength(9);
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

// CHANGED DELIBERATELY: both argv expectations below gained `--columns <set>`.
// `activity:list`'s DEFAULT columns include `Description`, whose content is
// personal data, so the spec now names the columns it wants (`commands.ts`).
const ACTIVITY_LIST_COLUMNS = "id,created,type,state,result,progress,completed,time_build,time_deploy,time_execute,time_wait";

describe("magentocloud_get_activities — list filters", () => {
  it("lists with no filter beyond the project and the explicit column set", async () => {
    mockExecFileOnce(0, readFixture("activity-list.txt"), "");

    const result = await toolNamed("magentocloud_get_activities").invoke({ projectId: "acme-demo-project" }, {});

    expect(result.isError).toBeUndefined();
    const argv = execFileMock.mock.calls.at(-1)?.[1] as readonly string[];
    expect(argv).toEqual(["activity:list", "--project", "acme-demo-project", "--columns", ACTIVITY_LIST_COLUMNS, "--format=tsv"]);
  });

  // The end-to-end half of the privacy guarantee: the serialized TOOL RESULT,
  // which is what actually reaches a model's context.
  it("never serializes a description, even when the CLI prints one anyway", async () => {
    const marker = "DEMOACTIVITYDESCRIPTION";
    const stdout =
      "ID\tCreated\tType\tState\tResult\tProgress\tCompleted\tBuild time (s)\tDeploy time (s)\tExec time (s)\tWait time (s)\tDescription\n" +
      `act-demo-0003\t2026-01-03T00:00:00+00:00\tenvironment_type.access.delete\tcomplete\tsuccess\t100%\t2026-01-03T00:00:03+00:00\t0\t0\t1\t0\t${marker}\n`;
    // POSITIVE CONTROL: the two probes below DO fire on the CLI output being
    // fed in, so a probe that simply cannot see the marker cannot "pass".
    expect(stdout).toContain(marker);
    expect(stdout).toMatch(/description/i);
    mockExecFileOnce(0, stdout, "");

    const result = await toolNamed("magentocloud_get_activities").invoke({ projectId: "acme-demo-project" }, {});

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toMatch(/description/i);
  });

  it("passes every supplied filter down to the CLI", async () => {
    mockExecFileOnce(0, readFixture("activity-list.txt"), "");

    await toolNamed("magentocloud_get_activities").invoke(
      {
        projectId: "acme-demo-project",
        environmentId: "acme-demo-env-main",
        limit: 5,
        type: "environment.push",
        state: "complete",
        result: "failure",
      },
      {},
    );

    const argv = execFileMock.mock.calls.at(-1)?.[1] as readonly string[];
    expect(argv).toEqual([
      "activity:list",
      "--project",
      "acme-demo-project",
      "--environment",
      "acme-demo-env-main",
      "--limit",
      "5",
      "--type",
      "environment.push",
      "--state",
      "complete",
      "--result",
      "failure",
      "--columns",
      ACTIVITY_LIST_COLUMNS,
      "--format=tsv",
    ]);
  });

  it.each([
    ["state", { state: "finished" }],
    ["result", { result: "ok" }],
    ["limit", { limit: 0 }],
  ])("rejects an out-of-domain %s at the wire gate, before any process is spawned", async (_field, filter) => {
    execFileMock.mockClear();

    await expect(
      toolNamed("magentocloud_get_activities").invoke({ projectId: "acme-demo-project", ...filter }, {}),
    ).rejects.toThrow();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  // A filter combined with activityId would be silently dropped — the
  // by-id branch runs `activity:get`, which has no filters at all. Saying so
  // is better than searching something other than what was asked for.
  it.each([["limit", { limit: 5 }], ["type", { type: "environment.push" }], ["state", { state: "complete" }], ["result", { result: "success" }]])(
    "rejects %s combined with activityId instead of ignoring it",
    async (_field, filter) => {
      execFileMock.mockClear();

      await expect(
        toolNamed("magentocloud_get_activities").invoke(
          { projectId: "acme-demo-project", activityId: "act-demo-0001", ...filter },
          {},
        ),
      ).rejects.toThrow();
      expect(execFileMock).not.toHaveBeenCalled();
    },
  );

  // POSITIVE CONTROL for the rule above: activityId on its own is still the
  // supported by-id read, so the refinement rejects the COMBINATION rather
  // than having broken the branch.
  it("positive control: activityId with no filter still fetches the one activity", async () => {
    mockExecFileOnce(0, readFixture("activity-get.txt"), "");

    const result = await toolNamed("magentocloud_get_activities").invoke(
      { projectId: "acme-demo-project", activityId: "act-demo-0001" },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(execFileMock.mock.calls.at(-1)?.[1]).toContain("activity:get");
  });
});

describe("magentocloud_get_activity_log", () => {
  it("returns the deployment log as plain text, exactly as the CLI printed it", async () => {
    const fixture = readFixture("activity-log.txt");
    mockExecFileOnce(0, fixture, "");

    const result = await toolNamed("magentocloud_get_activity_log").invoke(
      { projectId: "acme-demo-project", environmentId: "acme-demo-env-main", activityId: "act-demo-0001" },
      {},
    );

    expect(result.isError).toBeUndefined();
    // Raw text, NOT a JSON-wrapped record: a deployment log is prose, and
    // JSON-escaping it would make the one thing a caller reads unreadable.
    expect(result.content[0]?.text).toBe(fixture);
  });

  it("invokes activity:log with the activity id and no --format flag", async () => {
    mockExecFileOnce(0, readFixture("activity-log.txt"), "");

    await toolNamed("magentocloud_get_activity_log").invoke(
      { projectId: "acme-demo-project", environmentId: "acme-demo-env-main", activityId: "act-demo-0001" },
      {},
    );

    const argv = execFileMock.mock.calls.at(-1)?.[1] as readonly string[];
    expect(argv).toContain("activity:log");
    expect(argv).toContain("act-demo-0001");
    expect(argv.some((token) => token.startsWith("--format"))).toBe(false);
  });

  // Deliberately NOT the audited fork's "no id means the most recent
  // activity": that convenience needs a second CLI call to discover the id,
  // and then hides WHICH activity was read behind a result that looks like
  // an answer to the question the caller asked.
  it.each([
    ["activityId", { projectId: "p", environmentId: "e" }],
    ["projectId", { environmentId: "e", activityId: "a" }],
    ["environmentId", { projectId: "p", activityId: "a" }],
  ])("requires %s, rejecting the call before any process is spawned", async (_field, args) => {
    execFileMock.mockClear();

    await expect(toolNamed("magentocloud_get_activity_log").invoke(args, {})).rejects.toThrow();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("surfaces a CLI failure as isError: true, carrying the CLI's own message", async () => {
    const cliStderr = "Activity not found: act-demo-9999";
    mockExecFileOnce(1, "", cliStderr);

    const result = await invokeMagentoCloudTool(
      toolNamed("magentocloud_get_activity_log"),
      { projectId: "p", environmentId: "e", activityId: "act-demo-9999" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(cliStderr);
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
    // db:size writes only these three columns to stdout; its progress text
    // and deprecation notice go to stderr.
    mockExecFileOnce(0, "Allocated disk\tEstimated usage\t% used\n2147483648\t1073741824\t50\n", "");
    const [, , , , , , , queryDatabase] = buildTools();

    const result = await queryDatabase!.invoke({ projectId: "p", environmentId: "e", request: { kind: "size" } }, {});

    expect(result.isError).toBeUndefined();
    const [call] = execFileMock.mock.calls;
    expect(call?.[1]).toContain("db:size");
    expect(call?.[1]).not.toContain("db:sql");
    // The caller receives the CLI's own three figures, under names that say
    // what they are: two byte counts and an integer percentage.
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      kind: "size",
      allocated_disk: "2147483648",
      estimated_usage: "1073741824",
      percent_used: "50",
    });
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
    // CHANGED DELIBERATELY: a TSV table here was invented input.
    // `environment:relationships` rejects `--format` and prints YAML.
    mockExecFileOnce(
      0,
      [
        "database:",
        "    -",
        "        username: demo-svc-user",
        "        scheme: mysql",
        "        service: mysql",
        "        host: demo-db-host.internal",
        "        port: 3306",
        "        password: demo-svc-password-not-real",
        "",
      ].join("\n"),
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

// `environment:url` was built, parsed and allowlisted, and then called by
// nothing. It is exposed as a FACET of the environment-config tool rather
// than as a tool of its own: an environment's URLs are environment
// configuration, the facet tool already owns "fetch these parts of an
// environment on demand", and every existing facet already shares the same
// failure contract (one facet's CLI failure fails the call, carrying that
// CLI's own message).
describe("magentocloud_get_environment_config — the urls facet", () => {
  it("returns every URL the CLI printed, in the order it printed them", async () => {
    const fixture = readFixture("environment-url.txt");
    // Derived from the fixture bytes here, NOT from `parseEnvironmentUrls`:
    // the expectation must not come from the code under test.
    const expectedUrls = fixture.split("\n").filter((line) => line.trim().length > 0);
    expect(expectedUrls.length).toBeGreaterThan(1);
    mockExecFileOnce(0, fixture, "");
    const [, , , , , getEnvironmentConfig] = buildTools();

    const result = await getEnvironmentConfig!.invoke({ projectId: "p", environmentId: "e", include: ["urls"] }, {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ urls: expectedUrls });
  });

  it("invokes environment:url with --pipe and no --format flag", async () => {
    mockExecFileOnce(0, readFixture("environment-url.txt"), "");
    const [, , , , , getEnvironmentConfig] = buildTools();

    await getEnvironmentConfig!.invoke({ projectId: "p", environmentId: "e", include: ["urls"] }, {});

    const argv = execFileMock.mock.calls.at(-1)?.[1] as readonly string[];
    expect(argv).toContain("environment:url");
    expect(argv).toContain("--pipe");
    expect(argv.some((token) => token.startsWith("--format"))).toBe(false);
  });

  // `--pipe` prints one bare URL per line and marks NOTHING as primary. The
  // result therefore has no `primary` field: inventing one would mean
  // promoting "the CLI seems to print it first" into a claim a caller would
  // reasonably act on.
  it("declares no primary URL, because --pipe output carries no primary marker", async () => {
    mockExecFileOnce(0, readFixture("environment-url.txt"), "");
    const [, , , , , getEnvironmentConfig] = buildTools();

    const result = await getEnvironmentConfig!.invoke({ projectId: "p", environmentId: "e", include: ["urls"] }, {});

    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/primary/i);
    // POSITIVE CONTROL: the same probe DOES find the word when it is present,
    // so "no match" is evidence of absence rather than of a broken probe.
    expect(JSON.stringify({ primary: "x" })).toMatch(/primary/i);
  });

  // `environment:url` legitimately fails for environments that have none
  // (an inactive environment, for instance). That is a real answer, not a
  // bug, and it must reach the caller as the CLI's own words.
  it("surfaces a legitimate environment:url failure as isError: true, carrying the CLI's own message", async () => {
    const cliStderr = "No URLs found for the environment acme-demo-env-main.";
    mockExecFileOnce(1, "", cliStderr);
    const [, , , , , getEnvironmentConfig] = buildTools();

    const result = await invokeMagentoCloudTool(getEnvironmentConfig!, { projectId: "p", environmentId: "e", include: ["urls"] }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(cliStderr);
  });

  it("returns no urls key at all when the facet was not requested", async () => {
    mockExecFileOnce(0, readFixture("variable-list.txt"), "");
    const [, , , , , getEnvironmentConfig] = buildTools();

    const result = await getEnvironmentConfig!.invoke({ projectId: "p", environmentId: "e", include: ["variables"] }, {});

    expect(Object.keys(JSON.parse(result.content[0]?.text ?? "{}"))).toEqual(["variables"]);
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
      // CHANGED DELIBERATELY: this stub's stdout gained `Status`/`Created`.
      // `project:list` is now invoked with an explicit `--columns` set and its
      // parser requires the header row that set produces, so the old
      // three-column stub is output the real CLI would no longer print.
      cb(null, "ID\tTitle\tRegion\tStatus\tCreated\nmcproj-demo-0001\tDemo Project\tdemo-region\tactive\t2026-01-01T00:00:00+00:00\n", "");
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
      // CHANGED DELIBERATELY: same reason as the stub above — the header row
      // this parser requires is the one the pinned `--columns` set produces.
      cb(null, "ID\tTitle\tRegion\tStatus\tCreated\n", "");
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
