// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Rollout jobs (aem-sites-rollout-jobs). `/bin/asynccommand` answers before
// the rollout runs, and the shape of that answer is not recorded yet, so the
// server issues its own id for each accepted rollout and remembers what it
// was sent to. A job's status is read from the targets themselves: a target
// is reached once its `cq:lastRolledout` differs from its value when the
// rollout was planned. In memory only, like the plan store.
import { randomBytes } from "node:crypto";
import { readPage, type AemClient } from "../client/index.js";

/**
 * Why a target can keep its plan-time `cq:lastRolledout`. Observed on
 * 2026-11-03: AEM's Background Operations listed shallow rollouts as Success
 * within seconds while their targets showed no visible change.
 */
export const NOT_OBSERVED_NOTE =
  "No change of cq:lastRolledout is visible on the pending targets yet. That can mean the job has not run yet, or that it ran and AEM did not update that property (whether it does when there was nothing to sync is not verified). A rollout without deep does not create sub-pages that exist only in the source: roll out their parent with deep: true.";

/** Jobs remembered; the oldest is dropped first. */
export const MAX_REMEMBERED_JOBS = 500;

export interface RolloutTarget {
  readonly path: string;
  /** `cq:lastRolledout` when the rollout was planned; absent when the target had never been rolled out. */
  readonly before?: string;
}

export interface RolloutJob {
  readonly id: string;
  readonly env: string;
  readonly source: string;
  readonly deep: boolean;
  readonly targets: readonly RolloutTarget[];
  /** Epoch ms. */
  readonly acceptedAt: number;
  /** The author's JSON answer to the request, kept as is. */
  readonly authorResponse?: unknown;
}

export interface JobRegistry {
  add(job: Omit<RolloutJob, "id">): RolloutJob;
  get(id: string): RolloutJob | undefined;
}

export function createJobRegistry(options: { readonly randomId?: () => string } = {}): JobRegistry {
  const randomId = options.randomId ?? (() => `rollout-${randomBytes(6).toString("hex")}`);
  const jobs = new Map<string, RolloutJob>();
  return {
    add(job) {
      const created = { id: randomId(), ...job };
      jobs.set(created.id, created);
      if (jobs.size > MAX_REMEMBERED_JOBS) {
        const oldest = jobs.keys().next().value;
        if (oldest !== undefined) {
          jobs.delete(oldest);
        }
      }
      return created;
    },
    get: (id) => jobs.get(id),
  };
}

/** The targets whose `cq:lastRolledout` has not changed yet; a target that is gone counts as not reached. */
export async function pendingTargets(client: AemClient, targets: readonly RolloutTarget[]): Promise<readonly string[]> {
  const pending: string[] = [];
  for (const target of targets) {
    const page = await readPage(client.http, target.path, ["cq:lastRolledout"]);
    const last = page?.properties["cq:lastRolledout"];
    if (typeof last !== "string" || last === target.before) {
      pending.push(target.path);
    }
  }
  return pending;
}

export type JobStatusResult =
  | { readonly status: "unknown-job"; readonly jobId: string; readonly message: string }
  | {
      /** `completed`: every target has a new `cq:lastRolledout`. `not-observed`: some have not, see `note`. */
      readonly status: "not-observed" | "completed";
      readonly jobId: string;
      readonly env: string;
      readonly source: string;
      readonly deep: boolean;
      /** ISO 8601. */
      readonly acceptedAt: string;
      readonly elapsedSeconds: number;
      readonly reached: readonly string[];
      readonly pending: readonly string[];
      readonly note?: string;
    };

export interface JobStatusDeps {
  readonly clientFor: (env: string) => AemClient;
  readonly jobs: JobRegistry;
  readonly now: () => number;
}

export async function jobStatus(deps: JobStatusDeps, jobId: string): Promise<JobStatusResult> {
  const job = deps.jobs.get(jobId);
  if (job === undefined) {
    return {
      status: "unknown-job",
      jobId,
      message: "This server did not issue this job id, or has restarted since. Read the rollout targets with aem_get_page: cq:lastRolledout changes when a rollout reaches them.",
    };
  }
  const pending = await pendingTargets(deps.clientFor(job.env), job.targets);
  return {
    status: pending.length === 0 ? "completed" : "not-observed",
    jobId,
    env: job.env,
    source: job.source,
    deep: job.deep,
    acceptedAt: new Date(job.acceptedAt).toISOString(),
    elapsedSeconds: Math.round((deps.now() - job.acceptedAt) / 1000),
    reached: job.targets.map((t) => t.path).filter((path) => !pending.includes(path)),
    pending,
    ...(pending.length > 0 ? { note: NOT_OBSERVED_NOTE } : {}),
  };
}
