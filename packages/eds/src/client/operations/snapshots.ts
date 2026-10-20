// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Snapshot operations, pinned to `main` (design.md, Decision 5 & 7). Every
// write ALWAYS carries an explicit, non-empty JSON body — an empty body is
// inferred only (from the old Python CLI) to mean "add everything", and
// this client never relies on that inference.
//
// The reads require a document; the writes do not. Observed live, the same
// snapshot path answers `POST` with `200 application/json` and `DELETE`
// with `204 text/plain; charset=utf-8` and zero bytes — so a delete that
// genuinely removed the snapshot used to reach the operator as
// `Unexpected end of JSON input`. That split is why the writes return
// `SnapshotWriteResult` instead of the body directly.
import type { HttpClient, OptionalJsonBody } from "../http.js";
import { snapshotPath } from "../paths.js";

export interface SnapshotScope {
  readonly org: string;
  readonly site: string;
}

export interface SnapshotRef extends SnapshotScope {
  readonly id: string;
}

/**
 * What a snapshot write did, not just what it said. `hasContent` is false
 * for a `204` — the write succeeded and the API reported nothing — and
 * true with a `content` document otherwise, so a caller can tell "done"
 * from "done, and here is what came back" instead of reading an absent
 * body as an empty one.
 */
export type SnapshotWriteResult = OptionalJsonBody<unknown>;

export async function listSnapshots(http: HttpClient, scope: SnapshotScope): Promise<unknown> {
  return http.readJson({ method: "GET", path: snapshotPath(scope), label: "the snapshot list" });
}

export async function showSnapshot(http: HttpClient, ref: SnapshotRef): Promise<unknown> {
  return http.readJson({ method: "GET", path: snapshotPath(ref), label: "the snapshot" });
}

export interface AddToSnapshotOptions extends SnapshotRef {
  readonly paths?: readonly string[];
}

/** `paths` defaults to an explicit empty array — never an omitted body. */
export async function addToSnapshot(http: HttpClient, options: AddToSnapshotOptions): Promise<SnapshotWriteResult> {
  return http.readOptionalJson({
    method: "POST",
    path: snapshotPath(options),
    body: { paths: options.paths ?? [] },
    label: "the snapshot",
  });
}

export interface RemoveFromSnapshotOptions extends SnapshotRef {
  readonly paths: readonly string[];
}

export async function removeFromSnapshot(http: HttpClient, options: RemoveFromSnapshotOptions): Promise<SnapshotWriteResult> {
  return http.readOptionalJson({
    method: "POST",
    path: `${snapshotPath(options)}/remove`,
    body: { paths: options.paths },
    label: "the snapshot path removal",
  });
}

export async function publishSnapshot(http: HttpClient, ref: SnapshotRef): Promise<SnapshotWriteResult> {
  return http.readOptionalJson({ method: "POST", path: `${snapshotPath(ref)}/publish`, body: {}, label: "the snapshot publish" });
}

export interface ReviewSnapshotOptions extends SnapshotRef {
  readonly reviewAction: "approve" | "reject";
  readonly message?: string;
}

export async function reviewSnapshot(http: HttpClient, options: ReviewSnapshotOptions): Promise<SnapshotWriteResult> {
  return http.readOptionalJson({
    method: "POST",
    path: `${snapshotPath(options)}/review`,
    body: { reviewAction: options.reviewAction, message: options.message ?? "" },
    label: "the snapshot review",
  });
}

/** Answers `204` with zero bytes when it succeeds — see `SnapshotWriteResult`. */
export async function deleteSnapshot(http: HttpClient, ref: SnapshotRef): Promise<SnapshotWriteResult> {
  return http.readOptionalJson({ method: "DELETE", path: snapshotPath(ref), body: {}, label: "the snapshot deletion" });
}
