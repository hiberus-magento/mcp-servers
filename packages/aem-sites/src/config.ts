// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The server's environment contract (aem-sites-package design.md, D4, D5).
// Pure: `parseConfig` takes the variables as a record, so tests never touch
// `process.env`; `mcp.ts` and `cli.ts` pass the real one. A malformed value
// is a configuration error raised once, at startup — never discovered
// halfway through a plan.
import { assertAuthorOrigin } from "./client/index.js";
import { assertEnvName } from "./credential-provider.js";
import { parsePathPatterns, parseWriteRoots } from "./guard/paths.js";
import { parseExtraProperties } from "./guard/properties.js";

// The `*_ENV_VAR` naming is what `scripts/manifest-env.mjs` reads to check
// these names against `servers.json`'s `requires.env`.
export const AUTHORS_ENV_VAR = "AEM_AUTHORS";
export const WRITE_ROOTS_ENV_VAR = "AEM_WRITE_ROOTS";
export const EXTRA_PROPERTIES_ENV_VAR = "AEM_EXTRA_PROPERTIES";
export const PROTECTED_ENVS_ENV_VAR = "AEM_PROTECTED_ENVS";
export const PROTECTED_PATHS_ENV_VAR = "AEM_PROTECTED_PATHS";
export const ALLOW_PROTECTED_PUBLISH_ENV_VAR = "AEM_ALLOW_PROTECTED_PUBLISH";

export interface AemConfig {
  /** Environment name → author origin, in declaration order. */
  readonly authors: ReadonlyMap<string, string>;
  readonly writeRoots: readonly string[];
  readonly extraProperties: readonly string[];
  readonly protectedEnvs: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly allowProtectedPublish: boolean;
}

export class AemConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AemConfigError";
  }
}

export type EnvRecord = Readonly<Record<string, string | undefined>>;

function parseAuthors(raw: string | undefined): ReadonlyMap<string, string> {
  if (raw === undefined || raw.trim() === "") {
    throw new AemConfigError(
      "AEM_AUTHORS is required: a comma-separated list of <env>=<author origin>, e.g. AEM_AUTHORS=stage=https://author-p<program>-e<environment>.adobeaemcloud.com",
    );
  }
  const authors = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new AemConfigError(`AEM_AUTHORS entry "${trimmed}" is not <env>=<author origin>.`);
    }
    const env = trimmed.slice(0, separator).trim();
    const origin = trimmed.slice(separator + 1).trim();
    try {
      assertEnvName(env);
      assertAuthorOrigin(origin);
    } catch (error) {
      throw new AemConfigError(`AEM_AUTHORS: ${(error as Error).message}`);
    }
    if (authors.has(env)) {
      throw new AemConfigError(`AEM_AUTHORS declares "${env}" twice.`);
    }
    authors.set(env, origin);
  }
  if (authors.size === 0) {
    throw new AemConfigError("AEM_AUTHORS declares no environment.");
  }
  return authors;
}

function wrap<T>(variable: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw error instanceof AemConfigError ? error : new AemConfigError(`${variable}: ${(error as Error).message}`);
  }
}

export function parseConfig(env: EnvRecord): AemConfig {
  const authors = parseAuthors(env[AUTHORS_ENV_VAR]);
  const protectedEnvs = (env[PROTECTED_ENVS_ENV_VAR] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  for (const name of protectedEnvs) {
    if (!authors.has(name)) {
      throw new AemConfigError(`AEM_PROTECTED_ENVS names "${name}", which AEM_AUTHORS does not declare.`);
    }
  }
  const allow = env[ALLOW_PROTECTED_PUBLISH_ENV_VAR];
  if (allow !== undefined && allow !== "" && allow !== "0" && allow !== "1") {
    throw new AemConfigError('AEM_ALLOW_PROTECTED_PUBLISH must be "1" or "0".');
  }
  return {
    authors,
    writeRoots: wrap("AEM_WRITE_ROOTS", () => parseWriteRoots(env[WRITE_ROOTS_ENV_VAR])),
    extraProperties: wrap("AEM_EXTRA_PROPERTIES", () => parseExtraProperties(env[EXTRA_PROPERTIES_ENV_VAR])),
    protectedEnvs,
    protectedPaths: wrap("AEM_PROTECTED_PATHS", () => parsePathPatterns(env[PROTECTED_PATHS_ENV_VAR])),
    allowProtectedPublish: allow === "1",
  };
}

export function originFor(config: AemConfig, env: string): string {
  const origin = config.authors.get(env);
  if (origin === undefined) {
    throw new AemConfigError(`Unknown environment "${env}". Configured: ${[...config.authors.keys()].join(", ")}.`);
  }
  return origin;
}
