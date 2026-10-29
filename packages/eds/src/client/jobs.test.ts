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
import { fetchJobEnvelope, getJobStatus, listJobs, stopJob, waitForJob } from "./jobs.js";

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
  // CHANGED DELIBERATELY: this asserted `result.success === true`, which
  // became a constant once `send()` started throwing on every unhandled
  // non-ok status — it could no longer fail, so it proved nothing about
  // `=== 200` being the wrong test. What still discriminates is that a 202
  // RESOLVES while a non-2xx REJECTS, so that is what it asserts now.
  it("accepts HTTP 202 — any 2xx is a success, not just 200", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 202, body: RUNNING_FIXTURE },
    });

    const result = await fetchJobEnvelope(http, SELF_PATH);

    expect(result.body.job.state).toBe("running");
  });

  // POSITIVE CONTROL for the case above: without this, "202 resolves" is
  // satisfied by an implementation that resolves on everything.
  it("positive control: a non-2xx rejects rather than resolving", async () => {
    const { http } = makeHttp({
      [`GET ${SELF_PATH}`]: { status: 500 },
    });

    await expect(fetchJobEnvelope(http, SELF_PATH)).rejects.toThrow();
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

    // CHANGED DELIBERATELY: asserted `result.success`, which no longer
    // exists — it could only ever be true. The request path is what this
    // case is about, and `calls` already pins it above.
    expect(result.body.job.state).toBe("running");
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

// RED-first (eds-write-surface tasks.md 2.11): list a topic's jobs, and stop
// one by topic and name — success is any 2xx (eds-client spec, "Job Listing
// and Stopping"; "Job Success Is Any 2xx").
describe("listJobs", () => {
  it("reads the topic's job list", async () => {
    const list = { topic: "publish", jobs: [{ name: "job-demo-1", state: "running", time: "2026-01-01T00:00:00Z", href: "https://admin.hlx.page/job/x" }], links: { self: "s" } };
    const { http } = makeHttp({ "GET /job/acme-demo-org/acme-demo-site-eu/main/publish": { status: 200, body: list } });

    await expect(listJobs(http, { org: "acme-demo-org", site: "acme-demo-site-eu", topic: "publish" })).resolves.toEqual(list);
  });
});

describe("stopJob", () => {
  it("DELETEs the job by topic and name and accepts a 202", async () => {
    const { http, calls } = makeHttp({ "DELETE /job/acme-demo-org/acme-demo-site-eu/main/publish/job-demo-1": { status: 202 } });

    await expect(stopJob(http, { org: "acme-demo-org", site: "acme-demo-site-eu", topic: "publish", name: "job-demo-1" })).resolves.toEqual({ hasResponse: false });
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
  });
});
