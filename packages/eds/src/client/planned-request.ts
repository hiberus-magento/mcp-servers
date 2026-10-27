// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The one generic write in the client (eds-write-surface design.md, Open
// Questions, "How `eds_apply` replays requests"). `eds_plan` records the
// exact requests a confirmed plan will issue; `eds_apply` replays them here,
// one by one, so what is sent is what the user was shown — not what a typed
// operation would build today from the same arguments.
//
// It refuses, before any request: a method that is not a write, a path that
// is not an Admin API path on the configured host (a full URL or `//host`
// would carry `X-Auth-Token` elsewhere), and a request with two bodies.
import type { HttpClient } from "./http.js";
import { toWriteResult, type WriteResult } from "./operations/write-result.js";

export type PlannedRequest =
  | { readonly method: "POST" | "PUT" | "DELETE"; readonly path: string; readonly body?: unknown; readonly text?: undefined }
  | { readonly method: "POST" | "PUT" | "DELETE"; readonly path: string; readonly text: string; readonly body?: undefined };

const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "DELETE"]);

/** Root-relative, no `//host`, and no `.` / `..` segment that could walk out of the path the plan named. */
function isAdminApiPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return false;
  }
  const pathname = path.split("?", 1)[0] ?? "";
  return !pathname.split("/").some((segment) => segment === "." || segment === "..");
}

export async function sendPlannedRequest(http: HttpClient, request: PlannedRequest): Promise<WriteResult> {
  // Read once: the checks below run on values a caller typed loosely (a
  // stored plan), so the type system's narrowing is not what protects them.
  const { method, path } = request;
  if (!WRITE_METHODS.has(method)) {
    throw new Error(`Refusing to replay a ${method} request: only POST, PUT and DELETE are planned writes.`);
  }
  if (!isAdminApiPath(path)) {
    throw new Error(`Refusing to replay a request whose path is not a root-relative Admin API path: ${JSON.stringify(path)}.`);
  }
  if (request.body !== undefined && request.text !== undefined) {
    throw new Error(`Refusing to replay ${method} ${path}: it carries both a JSON body and a text body.`);
  }
  const written = await http.readOptionalJson({
    method,
    path,
    ...(request.body !== undefined ? { body: request.body } : {}),
    ...(request.text !== undefined ? { text: request.text } : {}),
    label: "the planned request",
  });
  return toWriteResult(written);
}
