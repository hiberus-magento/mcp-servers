// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { createPlanStore } from "./confirm/plan-store.js";
import { runCli, type CliDeps } from "./cli.js";
import { SYNTHETIC_AEM_AUTHOR, SYNTHETIC_ROOT, SYNTHETIC_TOKEN } from "./testing/author-double.js";
import { createFakeAuthor } from "./testing/fake-author.js";
import type { StoredPlan } from "./tools/plan-builder.js";

const PAGE = `${SYNTHETIC_ROOT}/en`;

function deps(overrides: Partial<CliDeps> = {}) {
  const author = createFakeAuthor();
  author.pages.set(PAGE, { "jcr:title": "EN" });
  const persisted: [string, string][] = [];
  const removed: string[] = [];
  const base: CliDeps = {
    readStdin: async () => "",
    readFile: () => JSON.stringify({ kind: "page.set-properties", path: PAGE, set: { "jcr:title": "English" } }),
    persist: (domain, token) => {
      persisted.push([domain, token]);
      return `/tmp/${domain}.json`;
    },
    removeFile: (path) => {
      removed.push(path);
      return true;
    },
    getRuntime: () => ({
      config: parseConfig({ AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_WRITE_ROOTS: SYNTHETIC_ROOT }),
      clientFor: () => author.client,
      store: createPlanStore<StoredPlan>({ now: () => 0 }),
      now: () => 0,
      sleep: async () => undefined,
      tokenSource: () => "file",
    }),
    configDir: "/nonexistent-aem-sites-test-dir",
    ...overrides,
  };
  return { base, author, persisted, removed };
}

describe("auth token", () => {
  it("never accepts a token as an argument", async () => {
    const { base, persisted } = deps();
    expect((await runCli(["auth", "token", "set", "--env", "stage", "--token", "x"], base)).exitCode).toBe(1);
    expect(persisted).toEqual([]);
  });

  it("reads stdin, normalizes the Developer Console JSON and stores it per environment", async () => {
    const { base, persisted } = deps({ readStdin: async () => `{"accessToken":"${SYNTHETIC_TOKEN}"}` });
    const result = await runCli(["auth", "token", "set", "--env", "stage"], base);
    expect(result.exitCode).toBe(0);
    expect(persisted).toEqual([["aem-sites-stage", SYNTHETIC_TOKEN]]);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).not.toContain(SYNTHETIC_TOKEN);
  });

  it("requires --env and refuses an empty stdin", async () => {
    const { base, persisted } = deps();
    expect((await runCli(["auth", "token", "set"], base)).exitCode).toBe(1);
    expect((await runCli(["auth", "token", "set", "--env", "stage"], base)).exitCode).toBe(1);
    expect(persisted).toEqual([]);
  });

  it("clear simulates without --yes", async () => {
    const { base, removed } = deps();
    expect((await runCli(["auth", "token", "clear", "--env", "stage"], base)).stdout).toContain("SIMULATION");
    expect(removed).toEqual([]);
    await runCli(["auth", "token", "clear", "--env", "stage", "--yes"], base);
    expect(removed).toHaveLength(1);
  });
});

describe("plan and apply", () => {
  it("plan prints the plan and writes nothing", async () => {
    const { base, author } = deps();
    const result = await runCli(["plan", "--env", "stage", "--operation", "op.json"], base);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"EN" → "English"');
    expect(author.posts()).toEqual([]);
  });

  it("apply without --yes is a simulation", async () => {
    const { base, author } = deps();
    expect((await runCli(["apply", "--env", "stage", "--operation", "op.json"], base)).stdout).toContain("SIMULATION");
    expect(author.posts()).toEqual([]);
  });

  it("apply --yes writes the planned request", async () => {
    const { base, author } = deps();
    const result = await runCli(["apply", "--env", "stage", "--operation", "op.json", "--yes"], base);
    expect(result.exitCode).toBe(0);
    expect(author.posts()).toHaveLength(1);
  });

  it("reports a rejection with its reason", async () => {
    const { base } = deps({ readFile: () => JSON.stringify({ kind: "page.set-properties", path: PAGE, set: { "sling:resourceType": "x" } }) });
    const result = await runCli(["apply", "--env", "stage", "--operation", "op.json", "--yes"], base);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("forbidden-property-name") });
  });
});

it("an unknown command prints usage", async () => {
  const { base } = deps();
  expect((await runCli(["site", "apply"], base)).stderr).toContain("Usage:");
});
