// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Reads the opt-in HTTP mode of a server from its environment. The bearer
// token comes from the environment only — never from argv, where it would
// land in shell history and `ps` (the same rule as the credential CLI).
// `env` is injected so this stays a pure function and testable without
// touching `process.env`.
export type HttpConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly port: number;
      readonly host: string;
      readonly token: string;
      readonly allowedHosts: readonly string[];
      readonly allowedOrigins: readonly string[];
    };

/**
 * The five variable names of a server, spelled out by the server itself (as `const *_ENV_VAR`
 * literals) rather than derived from a prefix here. `scripts/manifest-env.mjs` can only match
 * names that appear literally in the source, and it is what keeps `servers.json` honest.
 */
export interface HttpEnvNames {
  readonly port: string;
  readonly token: string;
  readonly host: string;
  readonly allowedHosts: string;
  readonly allowedOrigins: string;
}

const DEFAULT_HOST = "127.0.0.1";
const MAX_PORT = 65535;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * @param names the server's variable names
 * @param env   the environment to read, normally `process.env`
 *
 * HTTP is off unless the port variable is set, so a server started the way it always was
 * (stdio, from Claude Code) is unchanged.
 */
export function readHttpConfig(names: HttpEnvNames, env: Readonly<Record<string, string | undefined>>): HttpConfig {
  const rawPort = env[names.port]?.trim();
  if (rawPort === undefined || rawPort === "") {
    return { enabled: false };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`${names.port} must be an integer between 0 and ${MAX_PORT}.`);
  }
  // Trimmed: a token read from a secret file usually ends in a newline, and a caller never sends one.
  const token = env[names.token]?.trim();
  if (token === undefined || token === "") {
    throw new Error(`${names.token} is required when ${names.port} is set. Generate one with \`openssl rand -hex 32\`.`);
  }
  return {
    enabled: true,
    port,
    host: env[names.host]?.trim() || DEFAULT_HOST,
    token,
    allowedHosts: list(env[names.allowedHosts]),
    allowedOrigins: list(env[names.allowedOrigins]),
  };
}
