// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Job envelope parsing + waitForJob (design.md, Decision 5). Success is ANY
// 2xx status — the documented shape returns 202, and a strict-equality
// check against the literal HTTP 200 status code would reject it. Polls
// `links.self` verbatim, never a reconstructed URL: the audited CLI records
// that the URL topic does not always match the response topic for bulk
// operations, so reconstructing it is a known bug source.
import type { HttpClient } from "./http.js";
import { JobTimeoutError } from "./errors.js";
import { sitePath } from "./paths.js";

export type JobState = "created" | "running" | "stopped" | "completed";

export interface JobProgress {
  readonly total?: number;
  readonly processed?: number;
  readonly failed?: number;
}

export interface JobLinks {
  readonly self: string;
}

export interface JobDescriptor {
  readonly name: string;
  readonly topic: string;
  readonly state: JobState;
  readonly progress?: JobProgress;
}

export interface JobBody {
  readonly job: JobDescriptor;
  readonly links: JobLinks;
}

export interface JobEnvelopeResult {
  readonly success: boolean;
  readonly body: JobBody;
}

/**
 * Success is ANY 2xx status (eds-client spec, "Job Success Is Any 2xx") —
 * `response.ok` is exactly that check. A first pass here used a strict
 * equality check against the literal HTTP 200 status code; `jobs.test.ts`'s
 * 202 fixture failed against it, proving that comparison would have been
 * wrong before it was fixed to `response.ok`.
 */
export async function fetchJobEnvelope(http: HttpClient, self: string): Promise<JobEnvelopeResult> {
  const response = await http.send({ method: "GET", path: self });
  const success = response.ok;
  const body = (await response.json()) as JobBody;
  return { success, body };
}

export interface GetJobStatusOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly topic: string;
  readonly name: string;
}

/**
 * `eds_get_job_status` (design.md, Decision 7) addresses a job by
 * site/ref/topic/name, not by a `self` link handed back from another
 * operation — every other job-returning operation supplies its own `self`
 * link, so this is the one caller that must build the path itself. The
 * client owns that construction (not the MCP adapter) because
 * `paths.ts`/`sitePath` is internal to `client/` and the boundary lint
 * forbids an adapter reaching past `client/index.ts`.
 */
export async function getJobStatus(http: HttpClient, options: GetJobStatusOptions): Promise<JobEnvelopeResult> {
  const ref = options.ref ?? "main";
  const self = sitePath({ resource: "job", org: options.org, site: options.site, ref, suffix: `${options.topic}/${options.name}` });
  return fetchJobEnvelope(http, self);
}

const TERMINAL_STATES: ReadonlySet<JobState> = new Set(["completed", "stopped"]);
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface JobPollDeps {
  readonly http: HttpClient;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface WaitForJobOptions {
  readonly self: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly onProgress?: (progress: JobProgress | undefined) => void;
}

export async function waitForJob(deps: JobPollDeps, options: WaitForJobOptions): Promise<JobDescriptor> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = deps.now() + timeoutMs;
  let selfLink = options.self;
  let lastProgress: JobProgress | undefined;

  for (;;) {
    const { body } = await fetchJobEnvelope(deps.http, selfLink);
    lastProgress = body.job.progress;
    options.onProgress?.(lastProgress);
    selfLink = body.links.self;
    if (TERMINAL_STATES.has(body.job.state)) {
      return body.job;
    }
    if (deps.now() >= deadline) {
      throw new JobTimeoutError({ self: selfLink, progress: lastProgress });
    }
    await deps.sleep(pollIntervalMs);
  }
}
