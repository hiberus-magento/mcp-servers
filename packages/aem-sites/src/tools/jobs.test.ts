// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// aem-sites-mcp spec: "Live Copies" — rollout jobs. The registry remembers
// what an accepted rollout was sent to; the status reads each target's
// `cq:lastRolledout` against its value when the rollout was planned.
import { describe, expect, it } from "vitest";
import { SYNTHETIC_ROOT } from "../testing/author-double.js";
import { createFakeAuthor } from "../testing/fake-author.js";
import { createJobRegistry, jobStatus, MAX_REMEMBERED_JOBS } from "./jobs.js";

const SOURCE = `${SYNTHETIC_ROOT}/en/outdoor-gear`;
const FR = `${SYNTHETIC_ROOT}/fr/outdoor-gear`;
const DE = `${SYNTHETIC_ROOT}/de/outdoor-gear`;

function setup() {
  const author = createFakeAuthor();
  author.pages.set(FR, { "jcr:title": "FR", "cq:lastRolledout": "before" });
  author.pages.set(DE, { "jcr:title": "DE" });
  let ids = 0;
  const jobs = createJobRegistry({ randomId: () => `job-${(ids += 1)}` });
  const job = jobs.add({ env: "stage", source: SOURCE, deep: false, targets: [{ path: FR, before: "before" }, { path: DE }], acceptedAt: 60_000 });
  const status = (id: string, now = 120_000) => jobStatus({ clientFor: () => author.client, jobs, now: () => now }, id);
  return { author, jobs, job, status };
}

describe("rollout job registry", () => {
  it("issues an id per accepted rollout and finds it again", () => {
    const { jobs, job } = setup();
    expect(job.id).toBe("job-1");
    expect(jobs.get("job-1")).toEqual(job);
    expect(jobs.get("job-2")).toBeUndefined();
  });

  it("keeps the most recent jobs only", () => {
    const jobs = createJobRegistry();
    const first = jobs.add({ env: "stage", source: SOURCE, deep: false, targets: [{ path: FR }], acceptedAt: 0 });
    for (let i = 0; i < MAX_REMEMBERED_JOBS; i += 1) {
      jobs.add({ env: "stage", source: SOURCE, deep: false, targets: [{ path: FR }], acceptedAt: i });
    }
    expect(jobs.get(first.id)).toBeUndefined();
  });
});

describe("rollout job status", () => {
  it("is running while a target still has its plan-time cq:lastRolledout", async () => {
    const { status } = setup();
    expect(await status("job-1")).toEqual({
      status: "running",
      jobId: "job-1",
      env: "stage",
      source: SOURCE,
      deep: false,
      acceptedAt: new Date(60_000).toISOString(),
      elapsedSeconds: 60,
      reached: [],
      pending: [FR, DE],
    });
  });

  it("names the targets already reached and completes when every one is", async () => {
    const { author, status } = setup();
    author.pages.set(FR, { ...author.pages.get(FR), "cq:lastRolledout": "after" });
    expect(await status("job-1")).toMatchObject({ status: "running", reached: [FR], pending: [DE] });
    author.pages.set(DE, { ...author.pages.get(DE), "cq:lastRolledout": "after" });
    expect(await status("job-1")).toMatchObject({ status: "completed", reached: [FR, DE], pending: [] });
  });

  it("counts a target that has disappeared as pending", async () => {
    const { author, status } = setup();
    author.pages.set(FR, { "cq:lastRolledout": "after" });
    author.pages.delete(DE);
    expect(await status("job-1")).toMatchObject({ status: "running", reached: [FR], pending: [DE] });
  });

  it("answers unknown-job for an id it never issued, pointing at the targets' pages", async () => {
    const { status, author } = setup();
    expect(await status("forged")).toMatchObject({ status: "unknown-job", jobId: "forged", message: expect.stringContaining("aem_get_page") });
    expect(author.requests).toEqual([]);
  });
});
