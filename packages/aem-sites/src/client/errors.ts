// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Named failures of the author client. Every error carries the request it
// came from (method, path, label) and never the bearer token: the token is
// held by the `TokenProvider` and is never passed into an error.
import type { Remedy } from "@hiberus-magento/mcp-core";

export interface RequestDescription {
  readonly method: string;
  readonly path: string;
  readonly label?: string | undefined;
}

function describe(request: RequestDescription): string {
  return `${request.method} ${request.path}${request.label !== undefined ? ` (${request.label})` : ""}`;
}

export class AemError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AemError";
    this.status = status;
  }
}

export class InvalidAuthorOriginError extends AemError {
  constructor(origin: string) {
    super(`"${origin}" is not an AEM as a Cloud Service author origin: expected https://author-p<program>-e<environment>.adobeaemcloud.com.`);
    this.name = "InvalidAuthorOriginError";
  }
}

export type AemAuthReason = "token-expired-or-invalid" | "forbidden" | "redirected-to-login";

/**
 * The author refused the token, or answered with the login page instead of
 * the resource. The remedy names the command that stores a fresh token.
 */
export class AemAuthError extends AemError {
  readonly reason: AemAuthReason;
  readonly remedy: Remedy;

  constructor(options: { readonly reason: AemAuthReason; readonly status: number; readonly request: RequestDescription; readonly remedy: Remedy }) {
    const why = {
      "token-expired-or-invalid": "the author rejected the token (the local development token lasts 24 h)",
      forbidden: "the token's user lacks permission for this resource",
      "redirected-to-login": "the author answered with its login page — the token is expired or invalid",
    }[options.reason];
    super(
      `${describe(options.request)} → HTTP ${options.status}: ${why}.\n` +
        `Renew it with: ${options.remedy.cliCommand}   (reads the token from stdin)\n` +
        `Or set:        ${options.remedy.envVar}=<token>`,
      options.status,
    );
    this.name = "AemAuthError";
    this.reason = options.reason;
    this.remedy = options.remedy;
  }
}

export class AemStatusError extends AemError {
  readonly detail: string | undefined;

  constructor(options: { readonly status: number; readonly request: RequestDescription; readonly detail?: string | undefined }) {
    super(`${describe(options.request)} → HTTP ${options.status}${options.detail !== undefined ? `: ${options.detail}` : ""}`, options.status);
    this.name = "AemStatusError";
    this.detail = options.detail;
  }
}

export class AemMalformedBodyError extends AemError {
  constructor(options: { readonly status: number; readonly request: RequestDescription }) {
    super(`${describe(options.request)} → HTTP ${options.status}: the response is not the JSON this call expects.`, options.status);
    this.name = "AemMalformedBodyError";
  }
}

export class TransientNetworkError extends AemError {
  constructor(request: RequestDescription, cause: unknown) {
    super(`${describe(request)}: network error (${cause instanceof Error ? cause.message : String(cause)}).`);
    this.name = "TransientNetworkError";
  }
}
