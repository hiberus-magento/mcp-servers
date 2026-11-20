// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `changeset version` bumps each package.json but knows nothing about
// servers.json, whose `version` the README's pinned install snippets and the
// packages' manifest tests read. These tests pin the step that copies the
// published version back into the manifest.
import { describe, expect, it } from "vitest";
import { syncManifestVersions } from "./sync-manifest-versions.mjs";

const entry = (id, version) => ({ id, package: `@hiberus-magento/${id}`, version });

describe("syncManifestVersions", () => {
  it("copies each package's version into its servers.json entry", () => {
    const manifest = { servers: [entry("alpha", "0.0.0"), entry("beta", "0.1.1")] };
    const versions = { "@hiberus-magento/alpha": "0.1.0", "@hiberus-magento/beta": "0.2.0" };

    const { manifest: synced, changed } = syncManifestVersions(manifest, (name) => versions[name]);

    expect(synced.servers.map((server) => server.version)).toEqual(["0.1.0", "0.2.0"]);
    expect(changed).toEqual([
      { package: "@hiberus-magento/alpha", from: "0.0.0", to: "0.1.0" },
      { package: "@hiberus-magento/beta", from: "0.1.1", to: "0.2.0" },
    ]);
  });

  it("leaves an entry that already matches untouched and reports nothing for it", () => {
    const manifest = { servers: [entry("alpha", "0.1.0")] };

    const { manifest: synced, changed } = syncManifestVersions(manifest, () => "0.1.0");

    expect(synced).toEqual(manifest);
    expect(changed).toEqual([]);
  });

  it("does not modify the manifest it was given", () => {
    const manifest = { servers: [entry("alpha", "0.0.0")] };

    syncManifestVersions(manifest, () => "0.1.0");

    expect(manifest.servers[0].version).toBe("0.0.0");
  });

  it("refuses an entry whose package cannot be found, naming it", () => {
    const manifest = { servers: [entry("ghost", "0.0.0")] };

    expect(() => syncManifestVersions(manifest, () => undefined)).toThrow(/@hiberus-magento\/ghost/);
  });
});
