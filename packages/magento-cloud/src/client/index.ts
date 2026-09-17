// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY public surface of `packages/magento-cloud/src/client/` (design.md's
// preamble: "the whole domain under `src/client/`, whose only public
// surface is `client/index.ts`"). `cli.ts`, `mcp.ts`, and `tools/*.ts` MUST
// import exclusively from this file — never a deeper `client/**` path —
// enforced repo-wide by `eslint.config.js`'s client-boundary
// `no-restricted-imports` rule (proven for this package in
// `eslint-fixtures/deep-client-import.ts`, tasks.md 9.10-9.11).
export {
  ensureBinaryResolved,
  classifyCliFailure,
  classifyKill,
  parseCliVersion,
  resetCliVersionMemoForTests,
  resolveCliVersionInfo,
  MINIMUM_SUPPORTED_CLI_VERSION,
  TIME_ATTRIBUTION_FACTOR,
  type ClassifiedCliFailure,
  type CliVersionInfo,
  type KillClassification,
  type ClassifyKillInput,
} from "./classify.js";

export { locateBinary } from "./locate-binary.js";

export {
  MagentoCloudNotInstalledError,
  MagentoCloudNotAuthenticatedError,
  MagentoCloudUnsupportedVersionError,
  MagentoCloudOutputShapeError,
  MagentoCloudOutputCapError,
} from "./errors.js";

export {
  createMagentoCloudAllowlist,
  checkReadOnlyIsolation,
  READ_ONLY_SUBCOMMANDS,
  FORBIDDEN_SUBCOMMANDS,
  ROW_CAP,
  DB_SQL_MAX_OUTPUT_BYTES,
  DB_SQL_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  type ReadOnlyKey,
  type ForbiddenKey,
  type ReadOnlyIsolationViolation,
} from "./commands.js";

export { buildChildEnv, type BuildChildEnvInput } from "./child-env.js";

export { parseServiceEndpoints, getRawRelationshipsText, type ServiceEndpoint, type CliOnlyText } from "./relationships.js";

export { executeReadOnlyCommand, MagentoCloudCommandFailedError, type MagentoCloudFailureKind, type ExecuteReadOnlyCommandInput } from "./execute.js";

export { parseAuthInfo, AUTH_INFO_REQUIRED_KEYS, type AuthInfoRecord } from "./parsers/auth.js";
export { parseProjectList, parseProjectInfo, type ProjectListRow, type ProjectInfoRecord } from "./parsers/project.js";
export {
  parseEnvironmentList,
  parseEnvironmentInfo,
  parseEnvironmentUrl,
  type EnvironmentListRow,
  type EnvironmentInfoRecord,
} from "./parsers/environment.js";
export { parseActivityList, parseActivityGet, type ActivityListRow, type ActivityGetRecord } from "./parsers/activity.js";
export { parseVariableList, parseVariableGet, type VariableListRow, type VariableGetRecord } from "./parsers/variable.js";
export { parseRouteList, type RouteListRow } from "./parsers/route.js";
export { parseServiceList, type ServiceListRow } from "./parsers/service.js";
export { parseAppConfig } from "./parsers/app-config.js";
export { parseDbSize, type DbSizeRecord } from "./parsers/db.js";
export { parseSubscriptionInfo, type SubscriptionInfoRecord } from "./parsers/subscription.js";
export { parseDbSqlRows } from "./parsers/db-sql.js";
