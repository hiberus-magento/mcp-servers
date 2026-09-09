// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A credential is NEVER accepted as a CLI argument (design.md, Decision 5):
// the argument parser has no `--token` option at all, so shell history
// cannot contain a token even by accident. Tokens are accepted via stdin
// (`readTokenFromStdin`) or an environment variable only — there is no
// function anywhere in mcp-core that reads a token out of `argv`.
export interface CliRejection {
  readonly message: string;
}

export type CliParseResult = { readonly ok: true } | { readonly ok: false; readonly error: CliRejection };

const TOKEN_FLAG_MESSAGE =
  "The --token flag does not exist and never will. Pipe the token via stdin " +
  "(e.g. `echo \"$TOKEN\" | hiberus-<domain> auth token set`) or set the domain's environment variable instead.";

function isTokenFlag(arg: string): boolean {
  return arg === "--token" || arg.startsWith("--token=");
}

export function parseCredentialCliArgs(argv: readonly string[]): CliParseResult {
  const hasTokenFlag = argv.some(isTokenFlag);
  if (hasTokenFlag) {
    return { ok: false, error: { message: TOKEN_FLAG_MESSAGE } };
  }
  return { ok: true };
}

export interface CliRunResult {
  readonly exitCode: number;
  readonly message?: string;
}

export function runCredentialCli(argv: readonly string[]): CliRunResult {
  const parsed = parseCredentialCliArgs(argv);
  if (!parsed.ok) {
    return { exitCode: 1, message: parsed.error.message };
  }
  return { exitCode: 0 };
}

export function readTokenFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    process.stdin.on("error", reject);
  });
}
