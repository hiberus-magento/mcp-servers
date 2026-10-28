// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The public client surface. Code outside `client/` imports only this file
// (enforced by lint). There is no export that accepts a raw URL or raw form
// fields: reads build their own requests, writes go through the guarded
// builders, and `execute` sends only a `PlannedRequest` a builder produced.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { createAuthorHttp, type AuthorHttp, type AuthorResponse } from "./http.js";
import type { PlannedRequest } from "./builders.js";

export {
  buildCopyPage,
  buildCreatePage,
  buildCreateSheet,
  buildDeletePage,
  buildMovePage,
  buildReplicate,
  buildSetProperties,
  buildSetRobots,
  buildSheetColumns,
  buildSheetDeleteRow,
  buildSheetRow,
  InvalidOperationError,
  nextRowNode,
  parseRobots,
  SHEET_TEMPLATE,
  type PlannedRequest,
  type ReplicationAgent,
  type SetPropertiesInput,
  type WriteScope,
} from "./builders.js";
export {
  listTemplates,
  probeAuth,
  queryPages,
  queryPublishedPages,
  readPage,
  readPageTree,
  readSheet,
  type ComponentNode,
  type PageDetails,
  type PageHit,
  type PageList,
  type PageReplication,
  type QueryPagesOptions,
  type ReplicationState,
  type Sheet,
  type SheetRow,
  type TemplateHit,
} from "./reads.js";
export { AemAuthError, AemError, AemMalformedBodyError, AemStatusError, InvalidAuthorOriginError, TransientNetworkError, type AemAuthReason } from "./errors.js";
export { assertAuthorOrigin, type AuthorHttp } from "./http.js";

export interface AemClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly tokenProvider: TokenProvider;
  readonly origin: string;
}

export interface AemClient {
  readonly http: AuthorHttp;
  /** Sends one request a builder produced, byte for byte. */
  execute(request: PlannedRequest): Promise<AuthorResponse>;
}

export function createAemClient(deps: AemClientDeps): AemClient {
  const http = createAuthorHttp(deps);
  return {
    http,
    execute: (request) => http.send({ method: request.method, path: request.path, form: request.form, label: request.label }),
  };
}
