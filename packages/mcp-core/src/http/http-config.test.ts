// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { readHttpConfig, type HttpEnvNames } from "./http-config.js";

const TOKEN = "k".repeat(40);

// Literal names, as a server declares them: scripts/manifest-env.mjs matches these against servers.json.
const names = (prefix: string): HttpEnvNames => ({
  port: `${prefix}_HTTP_PORT`,
  token: `${prefix}_HTTP_TOKEN`,
  host: `${prefix}_HTTP_HOST`,
  allowedHosts: `${prefix}_HTTP_ALLOWED_HOSTS`,
  allowedOrigins: `${prefix}_HTTP_ALLOWED_ORIGINS`,
});

describe("readHttpConfig", () => {
  it("is disabled (stdio mode) when no port is configured", () => {
    expect(readHttpConfig(names("MAGENTO_GRAPHQL"), {})).toEqual({ enabled: false });
  });

  it("is disabled when the port is blank", () => {
    expect(readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "  " })).toEqual({ enabled: false });
  });

  it("reads port and token, binding to loopback by default", () => {
    const config = readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "3100", MAGENTO_GRAPHQL_HTTP_TOKEN: TOKEN });
    expect(config).toEqual({ enabled: true, port: 3100, host: "127.0.0.1", token: TOKEN, allowedHosts: [], allowedOrigins: [] });
  });

  it("reads an explicit host and comma-separated allow-lists, trimmed", () => {
    const config = readHttpConfig(names("MAGENTO_REST"), {
      MAGENTO_REST_HTTP_PORT: "3200",
      MAGENTO_REST_HTTP_TOKEN: TOKEN,
      MAGENTO_REST_HTTP_HOST: "0.0.0.0",
      MAGENTO_REST_HTTP_ALLOWED_HOSTS: "magento-rest:3200, mcp.internal:3200 ,",
      MAGENTO_REST_HTTP_ALLOWED_ORIGINS: "https://tools.example",
    });
    expect(config).toMatchObject({
      enabled: true,
      host: "0.0.0.0",
      allowedHosts: ["magento-rest:3200", "mcp.internal:3200"],
      allowedOrigins: ["https://tools.example"],
    });
  });

  it("throws, naming the variable, when HTTP is on but the token is missing", () => {
    expect(() => readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "3100" })).toThrow(/MAGENTO_GRAPHQL_HTTP_TOKEN/);
  });

  it("throws on a port that is not an integer in 0-65535", () => {
    for (const port of ["abc", "-1", "70000", "3.5"]) {
      expect(() => readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: port, MAGENTO_GRAPHQL_HTTP_TOKEN: TOKEN })).toThrow(
        /MAGENTO_GRAPHQL_HTTP_PORT/,
      );
    }
  });

  it("trims the token, so a secret file's trailing newline does not turn every call into a 401", () => {
    const config = readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "3100", MAGENTO_GRAPHQL_HTTP_TOKEN: `${TOKEN}\n` });
    expect(config).toMatchObject({ enabled: true, token: TOKEN });
  });

  it("treats a whitespace-only token as missing", () => {
    expect(() => readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "3100", MAGENTO_GRAPHQL_HTTP_TOKEN: "  \n" })).toThrow(/MAGENTO_GRAPHQL_HTTP_TOKEN is required/);
  });

  it("never puts the token in an error message", () => {
    try {
      readHttpConfig(names("MAGENTO_GRAPHQL"), { MAGENTO_GRAPHQL_HTTP_PORT: "nope", MAGENTO_GRAPHQL_HTTP_TOKEN: TOKEN });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN);
    }
  });
});
