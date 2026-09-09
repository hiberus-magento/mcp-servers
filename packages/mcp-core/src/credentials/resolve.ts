// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Credential resolution precedence and storage (design.md, Decision 5).
// `env[ENV_VAR]` → `$XDG_CONFIG_HOME/hiberus/<domain>.json` (default
// `$HOME/.config`) → fail. There is no third branch; this module never
// prompts. Writes are atomic (`writeFileSync(tmp, { mode: 0o600 })` +
// `rename`), the directory is created `0o700`, and a read whose file mode
// carries any group/world bit is refused outright, not warned about.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MissingCredentialError, type Remedy } from "./token-provider.js";

const RESTRICTIVE_FILE_MODE = 0o600;
const RESTRICTIVE_DIR_MODE = 0o700;

function defaultConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfigHome, "hiberus");
}

export function credentialFilePath(domain: string, configDir?: string): string {
  const dir = configDir ?? defaultConfigDir();
  return join(dir, `${domain}.json`);
}

interface CredentialFileContents {
  readonly token?: string;
}

class LooseCredentialFilePermissionsError extends Error {
  constructor(filePath: string, mode: number) {
    super(
      `Refusing to read credential file "${filePath}": mode ${mode.toString(8)} has group/world permissions. ` +
        `Expected ${RESTRICTIVE_FILE_MODE.toString(8)}.`,
    );
    this.name = "LooseCredentialFilePermissionsError";
  }
}

function readCredentialFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const stat = statSync(filePath);
  const mode = stat.mode & 0o777;
  if (mode !== RESTRICTIVE_FILE_MODE) {
    throw new LooseCredentialFilePermissionsError(filePath, mode);
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as CredentialFileContents;
  return parsed.token;
}

export interface CredentialSource {
  readonly domain: string;
  readonly envVar: string;
  readonly configDir?: string;
}

function buildRemedy(source: CredentialSource, filePath: string, reason: string): Remedy {
  return {
    domain: source.domain,
    cliCommand: `hiberus-${source.domain} auth token set`,
    envVar: source.envVar,
    configPath: filePath,
    reason,
  };
}

export function resolveCredentialValue(source: CredentialSource): string {
  const fromEnv = process.env[source.envVar];
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }

  const filePath = credentialFilePath(source.domain, source.configDir);
  const fromFile = readCredentialFile(filePath);
  if (fromFile !== undefined && fromFile !== "") {
    return fromFile;
  }

  throw new MissingCredentialError(buildRemedy(source, filePath, "not found"));
}

export function persistCredential(domain: string, token: string, configDir?: string): string {
  const dir = configDir ?? defaultConfigDir();
  mkdirSync(dir, { recursive: true, mode: RESTRICTIVE_DIR_MODE });
  const filePath = join(dir, `${domain}.json`);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify({ token }), { mode: RESTRICTIVE_FILE_MODE });
  renameSync(tmpPath, filePath);
  return filePath;
}
