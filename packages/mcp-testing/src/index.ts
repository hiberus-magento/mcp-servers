// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Public barrel for `@hiberus-magento/mcp-testing`.
export {
  describeConformance,
  checkAnnouncedVersion,
  checkReadOnlyIsolation,
  checkStdoutPurity,
  checkToolMetadataComplete,
  type AnnouncedVersionViolation,
  type ConformanceOptions,
  type McpServerInfo,
  type McpTool,
  type ReadOnlyIntrospection,
  type ReadOnlyIsolationViolation,
  type ShellOutProbe,
  type StdoutPurityViolation,
  type ToolMetadataViolation,
} from "./conformance/conformance.js";
export {
  COLD_START_BUDGET_MS,
  STARTUP_CPU_BUDGET_MS,
  checkColdStart,
  checkStartupCpu,
  measureMedianColdStart,
  measureOneColdStart,
  measureOneStartupCpu,
  measureStartupCpu,
  type ColdStartViolation,
  type StartupCpuSample,
  type StartupCpuViolation,
} from "./conformance/cold-start.js";
export { JsonRpcClient, type JsonRpcClientOptions, type RawStdoutLine } from "./jsonrpc-client.js";
export {
  SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX,
  SYNTHETIC_AC_VIEW_ID_PREFIX,
  SYNTHETIC_CURRENCIES,
  SYNTHETIC_DOMAIN,
  SYNTHETIC_LOCALES,
  SYNTHETIC_MC_ENVIRONMENT_IDS,
  SYNTHETIC_MC_HOST,
  SYNTHETIC_MC_PROJECT_ID,
  SYNTHETIC_MC_TOKEN,
  SYNTHETIC_ORG,
  SYNTHETIC_SITES,
  SYNTHETIC_VERTICALS,
  type SyntheticCurrency,
  type SyntheticLocale,
  type SyntheticMcEnvironmentId,
  type SyntheticSite,
  type SyntheticVertical,
} from "./fixtures/synthetic-identifiers.js";
