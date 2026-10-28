// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { AemConfigError, originFor, parseConfig } from "./config.js";
import { SYNTHETIC_AEM_AUTHOR, SYNTHETIC_ROOT } from "./testing/author-double.js";

const PROD = "https://author-p00000-e00002.adobeaemcloud.com";

describe("parseConfig", () => {
  it("parses every variable", () => {
    const config = parseConfig({
      AEM_AUTHORS: ` stage=${SYNTHETIC_AEM_AUTHOR} , prod=${PROD}`,
      AEM_WRITE_ROOTS: SYNTHETIC_ROOT,
      AEM_EXTRA_PROPERTIES: "acmeTeaser",
      AEM_PROTECTED_ENVS: "prod",
      AEM_PROTECTED_PATHS: "/content/*/en/internal",
      AEM_ALLOW_PROTECTED_PUBLISH: "1",
    });
    expect([...config.authors.entries()]).toEqual([
      ["stage", SYNTHETIC_AEM_AUTHOR],
      ["prod", PROD],
    ]);
    expect(config).toMatchObject({
      writeRoots: [SYNTHETIC_ROOT],
      extraProperties: ["acmeTeaser"],
      protectedEnvs: ["prod"],
      protectedPaths: ["/content/*/en/internal"],
      allowProtectedPublish: true,
    });
    expect(originFor(config, "prod")).toBe(PROD);
    expect(() => originFor(config, "qa")).toThrow(/Unknown environment/);
  });

  it("defaults to no roots, no extras, nothing protected", () => {
    expect(parseConfig({ AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}` })).toMatchObject({
      writeRoots: [],
      extraProperties: [],
      protectedEnvs: [],
      protectedPaths: [],
      allowProtectedPublish: false,
    });
  });

  const invalid: [string, Record<string, string>, RegExp][] = [
    ["missing AEM_AUTHORS", {}, /AEM_AUTHORS is required/],
    ["an entry without =", { AEM_AUTHORS: SYNTHETIC_AEM_AUTHOR }, /not <env>=<author origin>/],
    ["a non-author origin", { AEM_AUTHORS: "stage=https://example-domain.invalid" }, /not an AEM as a Cloud Service author origin/],
    ["an uppercase env name", { AEM_AUTHORS: `Stage=${SYNTHETIC_AEM_AUTHOR}` }, /Invalid AEM environment name/],
    ["a duplicated env", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR},stage=${PROD}` }, /twice/],
    ["a write root under /apps", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_WRITE_ROOTS: "/apps/acme" }, /under \/content/],
    ["an operator as extra property", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_EXTRA_PROPERTIES: "x@MoveFrom" }, /Sling POST operator/],
    ["a protected env that is not declared", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_PROTECTED_ENVS: "prod" }, /does not declare/],
    ["a bad protected path", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_PROTECTED_PATHS: "/content/a*" }, /AEM_PROTECTED_PATHS/],
    ["a bad allow flag", { AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR}`, AEM_ALLOW_PROTECTED_PUBLISH: "yes" }, /must be "1" or "0"/],
  ];
  for (const [name, variables, message] of invalid) {
    it(`refuses ${name}`, () => {
      expect(() => parseConfig(variables)).toThrow(AemConfigError);
      expect(() => parseConfig(variables)).toThrow(message);
    });
  }
});
