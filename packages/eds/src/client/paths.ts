// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// URL construction (design.md, Decision 2 & 5). Two distinct address
// shapes that must never be interchanged: `{org}/{site}/{ref}` for
// everything site-scoped, and GitHub's `{owner}/{repo}` for `code`
// endpoints. Snapshot paths are pinned to `main` and accept no `ref` field
// at all — pagination through history is out of scope for this domain.
export interface SitePathOptions {
  /** The Admin API resource verb, e.g. `"status"`, `"preview"`, `"live"`, `"config"`, `"job"`. */
  readonly resource: string;
  readonly org: string;
  readonly site: string;
  readonly ref: string;
  /** Appended verbatim after the ref segment, e.g. `/status.json` or a content path. */
  readonly suffix: string;
}

export function sitePath(options: SitePathOptions): string {
  const suffix = options.suffix.startsWith("/") ? options.suffix.slice(1) : options.suffix;
  return `/${options.resource}/${options.org}/${options.site}/${options.ref}/${suffix}`;
}

export interface CodePathOptions {
  readonly owner: string;
  readonly repo: string;
  readonly file: string;
}

export function codePath(options: CodePathOptions): string {
  const file = options.file.startsWith("/") ? options.file.slice(1) : options.file;
  return `/code/${options.owner}/${options.repo}/${file}`;
}

const SNAPSHOT_REF = "main";

export interface SnapshotPathOptions {
  readonly org: string;
  readonly site: string;
  readonly id?: string;
}

export function snapshotPath(options: SnapshotPathOptions): string {
  const base = `/snapshot/${options.org}/${options.site}/${SNAPSHOT_REF}`;
  return options.id !== undefined ? `${base}/${options.id}` : base;
}
