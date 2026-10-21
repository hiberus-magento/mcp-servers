// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Public barrel for `@hiberus-magento/mcp-core`. Every server package
// builds on these six primitives instead of talking to
// `@modelcontextprotocol/sdk` or `node:child_process` directly.
export { createStdioServer, type StdioServerBootstrap } from "./bootstrap/stdout-guard.js";
export { logger, type LogLevel, type Logger } from "./bootstrap/logger.js";
export { SERVER_VERSION_DEFINE, serverVersion } from "./version/server-version.js";

export {
  defineTool,
  type NonEmpty,
  type RegisteredTool,
  type ToolAnnotations,
  type ToolCallContent,
  type ToolCallResult,
  type ToolContext,
  type ToolDefinition,
} from "./tools/define-tool.js";
export { paginate, paginationSchema, type Pagination, type PaginatedResult } from "./tools/pagination.js";

export type { Argv, CommandRejection, CommandRejectionReason, CommandResult, CommandSpec, Result } from "./exec/command-spec.js";
export { CommandAllowlist, ForbiddenCommandError } from "./exec/allowlist.js";
export { validateArgv } from "./exec/validate-argv.js";
export { runAllowlisted } from "./exec/run-allowlisted.js";

export { truncate } from "./truncate/truncate.js";
export { redact } from "./redact/redact.js";

export {
  CredentialExpiredError,
  MintedTokenProvider,
  MissingCredentialError,
  StaticTokenProvider,
  type Credential,
  type MintedTokenProviderOptions,
  type Remedy,
  type StaticTokenProviderOptions,
  type TokenProvider,
} from "./credentials/token-provider.js";
export { credentialFilePath, persistCredential, resolveCredentialValue, type CredentialSource } from "./credentials/resolve.js";
export {
  parseCredentialCliArgs,
  readTokenFromStdin,
  runCredentialCli,
  type CliParseResult,
  type CliRejection,
  type CliRunResult,
} from "./credentials/cli.js";
