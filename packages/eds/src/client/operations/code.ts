// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Code bus status, sync and delete (eds-client spec, "Code Status, Sync and
// Delete"). Addressed by GitHub `{owner}/{repo}`, never `{org}/{site}`
// ("Domain-Specific Address Shapes"). Which repository a site uses is the
// caller's business — the MCP surface resolves it from the site document,
// never from model input (eds-mcp spec, "Code Operations Resolve the
// Repository From the Site").
import type { HttpClient } from "../http.js";
import { codePath } from "../paths.js";
import { toWriteResult, type WriteResult } from "./write-result.js";

export interface CodePathParams {
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly path: string;
}

function addressOf(params: CodePathParams): string {
  return codePath({ owner: params.owner, repo: params.repo, ref: params.ref ?? "main", file: params.path });
}

export async function getCodeStatus(http: HttpClient, params: CodePathParams): Promise<unknown> {
  return http.readJson({ method: "GET", path: addressOf(params), label: `the code status of ${params.path}` });
}

export async function syncCode(http: HttpClient, params: CodePathParams): Promise<WriteResult> {
  return toWriteResult(await http.readOptionalJson({ method: "POST", path: addressOf(params), label: `the code sync of ${params.path}` }));
}

export async function deleteCode(http: HttpClient, params: CodePathParams): Promise<WriteResult> {
  return toWriteResult(await http.readOptionalJson({ method: "DELETE", path: addressOf(params), label: `the code delete of ${params.path}` }));
}
