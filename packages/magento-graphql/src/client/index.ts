// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The public surface of `client/` — the only module the rest of the package may import from it
// (the client-boundary lint rule forbids a deep import). Pure by construction: it reads no
// environment, writes no output and never exits the process.
//
// `query()` and `mutate()` each check the document with the operation guard BEFORE anything is
// sent and refuse the other's operation (design D1). That check, not a tool's annotation, is
// what keeps the generic query tool read-only.
import { createGraphqlTransport, type GraphqlResult, type GraphqlTransportDeps } from "./http.js";
import { OperationGuardError, inspectDocument } from "./operation-guard.js";

export { MagentoGraphqlError, type MagentoGraphqlErrorKind } from "./errors.js";
export { MAX_DOCUMENT_CHARS, MAX_SELECTION_DEPTH, OperationGuardError, inspectDocument, type DocumentInfo } from "./operation-guard.js";
export type { GraphqlResult, GraphqlTransportDeps } from "./http.js";

export interface OperationOptions {
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly store?: string;
  readonly currency?: string;
}

export interface MagentoGraphqlClient {
  /** Runs exactly one read-only query; anything else is refused before a request is made. */
  query(document: string, options?: OperationOptions): Promise<GraphqlResult>;
  /** Runs exactly one mutation; anything else is refused before a request is made. */
  mutate(document: string, options?: OperationOptions): Promise<GraphqlResult>;
}

export function createMagentoGraphqlClient(deps: GraphqlTransportDeps): MagentoGraphqlClient {
  const transport = createGraphqlTransport(deps);

  function run(kind: "query" | "mutation", document: string, options: OperationOptions | undefined): Promise<GraphqlResult> {
    const info = inspectDocument(document);
    if (info.operations !== 1) {
      throw new OperationGuardError(`The document has ${info.operations} operations; send exactly one.`);
    }
    if (info.kind !== kind) {
      throw new OperationGuardError(
        kind === "query" ? `This tool runs queries only; the document is a ${info.kind}.` : `This tool runs mutations only; the document is a ${info.kind === "query" ? "query" : info.kind}.`,
      );
    }
    return transport.execute({ kind, document, ...(options?.variables !== undefined ? { variables: options.variables } : {}), ...(options?.store !== undefined ? { store: options.store } : {}), ...(options?.currency !== undefined ? { currency: options.currency } : {}) });
  }

  return {
    query: async (document, options) => run("query", document, options),
    mutate: async (document, options) => run("mutation", document, options),
  };
}
