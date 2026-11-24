// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The release workflow versions and publishes on the merge to main, without the changesets action, so it creates
// the GitHub releases the action used to create: one per tag `changeset publish` made, with that version's
// CHANGELOG section as its notes. These tests pin the two pure steps: reading the new tags from the publish log,
// and cutting a version's section out of a CHANGELOG.
import { describe, expect, it } from "vitest";
import { newTags, releaseNotes } from "./github-releases.mjs";

describe("newTags", () => {
  it("reads every tag changeset publish reports, colours and all", () => {
    const log = [
      "🦋  info Publishing \u001b[36m\"@hiberus-magento/magento-rest\"\u001b[39m at \u001b[32m\"0.6.0\"\u001b[39m",
      "🦋  \u001b[32msuccess\u001b[39m packages published successfully:",
      "🦋  @hiberus-magento/magento-rest@0.6.0",
      "🦋  Creating git tag...",
      "🦋  New tag:  @hiberus-magento/magento-rest@0.6.0",
      "🦋  New tag:  \u001b[36m@hiberus-magento/aco@1.2.0-rc.1\u001b[39m",
    ].join("\n");
    expect(newTags(log)).toEqual([
      { tag: "@hiberus-magento/magento-rest@0.6.0", name: "@hiberus-magento/magento-rest", version: "0.6.0" },
      { tag: "@hiberus-magento/aco@1.2.0-rc.1", name: "@hiberus-magento/aco", version: "1.2.0-rc.1" },
    ]);
  });

  it("returns nothing when nothing was published", () => {
    expect(newTags("🦋  No unpublished projects to publish\n")).toEqual([]);
  });
});

describe("releaseNotes", () => {
  const changelog = [
    "# @hiberus-magento/magento-rest",
    "",
    "## 0.6.0",
    "",
    "### Minor Changes",
    "",
    "- abc1234: New write tools.",
    "",
    "## 0.5.0",
    "",
    "### Minor Changes",
    "",
    "- def5678: active_on.",
    "",
  ].join("\n");

  it("cuts out the section of that version, without its heading", () => {
    expect(releaseNotes(changelog, "0.6.0")).toBe("### Minor Changes\n\n- abc1234: New write tools.");
  });

  it("reads the last section to the end of the file", () => {
    expect(releaseNotes(changelog, "0.5.0")).toBe("### Minor Changes\n\n- def5678: active_on.");
  });

  it("does not take a version for one it merely starts with", () => {
    expect(releaseNotes("## 0.6.10\n\n- later\n\n## 0.6.1\n\n- this one\n", "0.6.1")).toBe("- this one");
  });

  it("falls back to a plain line when the CHANGELOG has no section for it", () => {
    expect(releaseNotes(changelog, "9.9.9")).toBe("Release 9.9.9.");
  });
});
