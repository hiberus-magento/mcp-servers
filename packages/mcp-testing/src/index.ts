// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Public barrel for `@hiberus-magento/mcp-testing`.
export { describeConformance, type ConformanceOptions, type ReadOnlyIntrospection } from "./conformance/conformance.js";
export { JsonRpcClient, type JsonRpcClientOptions, type RawStdoutLine } from "./jsonrpc-client.js";
export {
  SYNTHETIC_DOMAIN,
  SYNTHETIC_LOCALES,
  SYNTHETIC_ORG,
  SYNTHETIC_SITES,
  SYNTHETIC_VERTICALS,
  type SyntheticLocale,
  type SyntheticSite,
  type SyntheticVertical,
} from "./fixtures/synthetic-identifiers.js";
