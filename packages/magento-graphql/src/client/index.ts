// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The public surface of `client/` — the only module the rest of the package may import from it
// (the client-boundary lint rule forbids a deep import). Pure by construction: it reads no
// environment, writes no output and never exits the process.
//
// `query()` and `mutate()` each check the document with the operation guard BEFORE anything is
// sent and refuse the other's operation (design D1). That check, not a tool's annotation, is
// what keeps the generic query tool read-only. A fixed document of this package (`adapt: true`)
// is adapted to the connected store's schema first (design D12, `adapt.ts`).
import { createGraphqlTransport, type GraphqlResult, type GraphqlTransport, type GraphqlTransportDeps } from "./http.js";
import { createSchemaSource, createTrimCache, sendAdapted, sendWithFallback, type OffersOperation } from "./adapt.js";
import { OperationGuardError, inspectDocument } from "./operation-guard.js";
import { STORE_SCHEMA_QUERY, type StoreSchema } from "./schema.js";

export { MagentoGraphqlError, type MagentoGraphqlErrorKind } from "./errors.js";
export { MAX_FALLBACK_RETRIES, type OffersOperation } from "./adapt.js";
export { MAX_DOCUMENT_CHARS, MAX_SELECTION_DEPTH, OperationGuardError, inspectDocument, type DocumentInfo } from "./operation-guard.js";
export type { GraphqlResult, GraphqlTransportDeps } from "./http.js";
export { DocumentReadError, readDocument, rootOperations, trimDocument, type TrimOutcome } from "./document.js";
export { STORE_SCHEMA_QUERY, offersOperation, readStoreSchema, type StoreSchema } from "./schema.js";

export interface OperationOptions {
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly store?: string;
  readonly currency?: string;
  /**
   * The document is a FIXED one of this package: adapt it to the connected store's schema before sending it
   * (design D12). Never set for a caller-written document — the generic query tool's is sent as written.
   */
  readonly adapt?: boolean;
}

/** Options every request of a client view carries. */
export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface MagentoGraphqlClient {
  /** Runs exactly one read-only query; anything else is refused before a request is made. */
  query(document: string, options?: OperationOptions): Promise<GraphqlResult>;
  /** Runs exactly one mutation; anything else is refused before a request is made. */
  mutate(document: string, options?: OperationOptions): Promise<GraphqlResult>;
  /** The same client, every request also carrying these options. */
  with(options: RequestOptions): MagentoGraphqlClient;
}

export interface MagentoGraphqlClientDeps extends GraphqlTransportDeps {
  /** Whether `adapt: true` documents are adapted to the store's schema (design D12). Defaults to true. */
  readonly adaptToSchema?: boolean;
  /** Told once, when the store's schema has been read, which root operations it offers. */
  readonly onSchema?: (offers: OffersOperation) => void;
}

interface Adaptation {
  readonly schema: (signal?: AbortSignal) => Promise<StoreSchema | undefined>;
  readonly trim: ReturnType<typeof createTrimCache>;
}

export function createMagentoGraphqlClient(deps: MagentoGraphqlClientDeps): MagentoGraphqlClient {
  const transport = createGraphqlTransport(deps);
  const adaptation: Adaptation | undefined =
    deps.adaptToSchema === false ? undefined : { schema: createSchemaSource(async () => transport.execute({ kind: "query", document: STORE_SCHEMA_QUERY }), deps.onSchema), trim: createTrimCache() };
  return clientView(transport, adaptation, {});
}

function clientView(transport: GraphqlTransport, adaptation: Adaptation | undefined, bound: RequestOptions): MagentoGraphqlClient {
  async function run(kind: "query" | "mutation", document: string, options: OperationOptions | undefined): Promise<GraphqlResult> {
    // The guard runs first, on the document as given: a wrong kind is refused before anything is sent, the schema read included.
    const info = inspectDocument(document);
    if (info.operations !== 1) {
      throw new OperationGuardError(`The document has ${info.operations} operations; send exactly one.`);
    }
    if (info.kind !== kind) {
      throw new OperationGuardError(
        kind === "query" ? `This tool runs queries only; the document is a ${info.kind}.` : `This tool runs mutations only; the document is a ${info.kind === "query" ? "query" : info.kind}.`,
      );
    }
    const send = async (text: string, variables: Readonly<Record<string, unknown>> | undefined): Promise<GraphqlResult> => {
      // A trimmed document passes the same guard before it leaves.
      if (text !== document) inspectDocument(text);
      return transport.execute({ kind, document: text, ...(variables !== undefined ? { variables } : {}), ...(options?.store !== undefined ? { store: options.store } : {}), ...(options?.currency !== undefined ? { currency: options.currency } : {}), ...bound });
    };
    if (options?.adapt !== true || adaptation === undefined) {
      return send(document, options?.variables);
    }
    const schema = await adaptation.schema(bound.signal);
    return schema !== undefined ? sendAdapted(kind, document, options.variables, adaptation.trim(document, schema), send) : sendWithFallback(kind, document, options.variables, send);
  }

  return {
    query: async (document, options) => run("query", document, options),
    mutate: async (document, options) => run("mutation", document, options),
    with: (more) => clientView(transport, adaptation, { ...bound, ...more }),
  };
}
