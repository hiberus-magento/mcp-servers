// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Snapshot operations, pinned to `main` (design.md, Decision 5 & 7). Every
// write ALWAYS carries an explicit, non-empty JSON body — an empty body is
// inferred only (from the old Python CLI) to mean "add everything", and
// this client never relies on that inference.
import type { HttpClient } from "../http.js";
import { snapshotPath } from "../paths.js";

export interface SnapshotScope {
  readonly org: string;
  readonly site: string;
}

export interface SnapshotRef extends SnapshotScope {
  readonly id: string;
}

export async function listSnapshots(http: HttpClient, scope: SnapshotScope): Promise<unknown> {
  const response = await http.send({ method: "GET", path: snapshotPath(scope) });
  return response.json();
}

export async function showSnapshot(http: HttpClient, ref: SnapshotRef): Promise<unknown> {
  const response = await http.send({ method: "GET", path: snapshotPath(ref) });
  return response.json();
}

export interface AddToSnapshotOptions extends SnapshotRef {
  readonly paths?: readonly string[];
}

/** `paths` defaults to an explicit empty array — never an omitted body. */
export async function addToSnapshot(http: HttpClient, options: AddToSnapshotOptions): Promise<unknown> {
  const response = await http.send({
    method: "POST",
    path: snapshotPath(options),
    body: { paths: options.paths ?? [] },
  });
  return response.json();
}

export interface RemoveFromSnapshotOptions extends SnapshotRef {
  readonly paths: readonly string[];
}

export async function removeFromSnapshot(http: HttpClient, options: RemoveFromSnapshotOptions): Promise<unknown> {
  const response = await http.send({
    method: "POST",
    path: `${snapshotPath(options)}/remove`,
    body: { paths: options.paths },
  });
  return response.json();
}

export async function publishSnapshot(http: HttpClient, ref: SnapshotRef): Promise<unknown> {
  const response = await http.send({ method: "POST", path: `${snapshotPath(ref)}/publish`, body: {} });
  return response.json();
}

export interface ReviewSnapshotOptions extends SnapshotRef {
  readonly reviewAction: "approve" | "reject";
  readonly message?: string;
}

export async function reviewSnapshot(http: HttpClient, options: ReviewSnapshotOptions): Promise<unknown> {
  const response = await http.send({
    method: "POST",
    path: `${snapshotPath(options)}/review`,
    body: { reviewAction: options.reviewAction, message: options.message ?? "" },
  });
  return response.json();
}

export async function deleteSnapshot(http: HttpClient, ref: SnapshotRef): Promise<unknown> {
  const response = await http.send({ method: "DELETE", path: snapshotPath(ref), body: {} });
  return response.json();
}
