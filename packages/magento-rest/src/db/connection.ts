// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The database connection: what `MAGENTO_REST_DATABASE_CONNECTION` may say, and where the password comes from.
//
// The connection string is the part of the configuration that gets committed (`templates/mcp.json` is copied into
// project repositories), so it carries NO secret: `mysql://user@host:port/database`. A password in it is refused
// outright — and never echoed in the error — rather than silently used, because the next person to read the
// project's `.mcp.json` would be reading a credential. The password has its own variable, or the credential file
// `hiberus-magento-rest auth db-password set` writes (mode 0600, same mechanism as the REST token).
//
// TLS follows the host: any host that is not this machine gets it unless the operator writes `?ssl=false`; a local
// one does not need it. `ssl=true` means a verified connection (certificate and host name), never "encrypted but
// unchecked".
import { MissingCredentialError, credentialFilePath, resolveCredentialValue } from "@hiberus-magento/mcp-core";

export const DATABASE_CONNECTION_ENV_VAR = "MAGENTO_REST_DATABASE_CONNECTION";
export const DATABASE_PASSWORD_ENV_VAR = "MAGENTO_REST_DATABASE_PASSWORD";
export const DATABASE_ALLOW_WRITES_ENV_VAR = "MAGENTO_REST_DATABASE_ALLOW_WRITES";
/** The credential file's domain: `~/.config/hiberus/magento-rest-db.json`. */
export const DATABASE_CREDENTIAL_DOMAIN = "magento-rest-db";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
  readonly ssl: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(reason: string): never {
  throw new DatabaseConfigError(`${DATABASE_CONNECTION_ENV_VAR}: ${reason}`);
}

export function parseDatabaseConnection(value: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // The value is deliberately not quoted: a malformed string may still contain a password.
    return fail("not a connection URL. Expected mysql://<user>@<host>[:<port>]/<database>");
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    return fail("the scheme must be mysql:// or mariadb://");
  }
  if (url.password !== "" || value.includes(`${url.username}:@`)) {
    return fail("a password must not be part of the connection string (it would be committed with the project). Set MAGENTO_REST_DATABASE_PASSWORD, or run `hiberus-magento-rest auth db-password set`");
  }
  const user = decodeURIComponent(url.username);
  if (user === "") {
    return fail("the user is missing. Expected mysql://<user>@<host>/<database>");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") {
    return fail("the database name is missing. Expected mysql://<user>@<host>/<database>");
  }
  if (url.hostname === "") {
    return fail("the host is missing");
  }
  const port = url.port === "" ? 3306 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail("the port must be between 1 and 65535");
  }

  let ssl = !LOOPBACK_HOSTS.has(url.hostname);
  for (const [key, option] of url.searchParams) {
    if (key !== "ssl") {
      return fail(`the option "${key}" is not supported; the only option is ssl=true|false`);
    }
    if (option !== "true" && option !== "false") {
      return fail("ssl must be true or false");
    }
    ssl = option === "true";
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port, user, database, ssl };
}

/** The password, from the environment variable or the credential file; a missing one names both ways to supply it. */
export function resolveDatabasePassword(configDir?: string): string {
  try {
    return resolveCredentialValue({ domain: DATABASE_CREDENTIAL_DOMAIN, envVar: DATABASE_PASSWORD_ENV_VAR, ...(configDir !== undefined ? { configDir } : {}) });
  } catch (error) {
    if (error instanceof MissingCredentialError) {
      throw new DatabaseConfigError(
        `No database password found. Set ${DATABASE_PASSWORD_ENV_VAR}, or store it with \`hiberus-magento-rest auth db-password set\` (read from stdin, saved to ${credentialFilePath(DATABASE_CREDENTIAL_DOMAIN, configDir)}).`,
      );
    }
    throw error;
  }
}
