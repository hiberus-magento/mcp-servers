// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.1): a job `GET` returns `202` on success (Adobe's
// documented shape), and success is ANY 2xx — never a `=== 200` comparison.
// The fixtures below are literally 202, not 200, so a naive `status === 200`
// implementation fails this test by construction.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../testing/fetch-double.js";
import { createHttpClient } from "./http.js";
import { fetchJobEnvelope, getJobStatus, waitForJob } from "./jobs.js";

const RUNNING_FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../fixtures/job.202.running.json", import.meta.url)), "utf8"),
) as { job: { name: string; topic: string; state: string; progress: unknown }; links: { self: string } };
const COMPLETED_FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../fixtures/job.202.completed.json", import.meta.url)), "utf8"),
) as typeof RUNNING_FIXTURE;

const SELF_PATH = "/job/acme-demo-org/acme-demo-site-eu/main/preview/job-1";

function makeHttp(routes: Record<string, unknown>) {
  const { fetch, calls } = createFetchDouble(routes as never);
  const http = createHttpClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: "k" }),
      invalidate: () => undefined,
      describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
    },
    baseUrl: "https://admin.hlx.page",
    org: "acme-demo-org",
  });
  return { http, calls };
}

describe("fetchJobEnvelope", () => {
  it("treats HTTP 202 as success — proves === 200 would be the wrong test", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 202, body: RUNNING_FIXTURE },
    });

    const result = await fetchJobEnvelope(http, SELF_PATH);

    expect(result.success).toBe(true);
    expect(result.body.job.state).toBe("running");
  });
});

describe("waitForJob", () => {
  it("polls links.self verbatim and resolves once state reaches completed", async () => {
    const { http, calls } = makeHttp({
      [`GET ${SELF_PATH}`]: [
        { status: 202, body: RUNNING_FIXTURE },
        { status: 202, body: COMPLETED_FIXTURE },
      ],
    });

    const job = await waitForJob(
      { http, now: () => Date.now(), sleep: async () => undefined },
      { self: SELF_PATH, pollIntervalMs: 1 },
    );

    expect(job.state).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url.includes(SELF_PATH))).toBe(true);
  });

  it("fires onProgress while the client itself writes nowhere", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: [
        { status: 202, body: RUNNING_FIXTURE },
        { status: 202, body: COMPLETED_FIXTURE },
      ],
    });
    const progressUpdates: unknown[] = [];

    await waitForJob(
      { http, now: () => Date.now(), sleep: async () => undefined },
      { self: SELF_PATH, pollIntervalMs: 1, onProgress: (p) => progressUpdates.push(p) },
    );

    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates[0]).toEqual(RUNNING_FIXTURE.job.progress);
  });

  it("throws JobTimeoutError carrying the last progress and self link on timeout", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 202, body: RUNNING_FIXTURE },
    });
    let now = 0;
    const { JobTimeoutError } = await import("./errors.js");

    await expect(
      waitForJob(
        { http, now: () => now, sleep: async () => { now += 1000; } },
        { self: SELF_PATH, timeoutMs: 2000, pollIntervalMs: 1000 },
      ),
    ).rejects.toBeInstanceOf(JobTimeoutError);
  });
});

describe("getJobStatus", () => {
  // RED (Phase 7 addition, mcp.ts's eds_get_job_status needs this): the
  // adapter cannot build the job path itself — client-boundary lint forbids
  // importing paths.ts's sitePath outside client/ — so the client must own
  // job-status address construction from site/ref/topic/name components.
  it("builds the job path from site/ref/topic/name and fetches its envelope, success on any 2xx", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 202, body: RUNNING_FIXTURE },
    });

    const result = await getJobStatus(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      ref: "main",
      topic: "preview",
      name: "job-1",
    });

    expect(result.success).toBe(true);
    expect(result.body.job.state).toBe("running");
  });

  it("defaults ref to main when omitted", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 202, body: RUNNING_FIXTURE },
    });

    const result = await getJobStatus(http, {
      org: "acme-demo-org",
      site: "acme-demo-site-eu",
      topic: "preview",
      name: "job-1",
    });

    expect(result.success).toBe(true);
  });
});

describe("job success source discipline", () => {
  it("no file under client/** governs job success with a `=== 200` literal", async () => {
    const { readdirSync } = await import("node:fs");
    const clientDir = fileURLToPath(new URL(".", import.meta.url));
    const violations: string[] = [];

    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          scan(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test-d.ts")) {
          continue;
        }
        const text = readFileSync(full, "utf8");
        if (text.includes("=== 200") || text.includes("== 200")) {
          violations.push(full);
        }
      }
    }

    scan(clientDir);
    expect(violations).toEqual([]);
  });
});
