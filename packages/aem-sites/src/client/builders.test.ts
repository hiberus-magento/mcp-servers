// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { SYNTHETIC_ROOT } from "../testing/author-double.js";
import { InvalidAemPathError, PathOutsideWriteRootsError } from "../guard/paths.js";
import { ForbiddenPropertyNameError, InvalidPropertyValueError } from "../guard/properties.js";
import {
  buildCopyPage,
  buildCreatePage,
  buildCreateSheet,
  buildDeletePage,
  buildMovePage,
  buildReplicate,
  buildSetProperties,
  buildSetRobots,
  buildSheetColumns,
  buildSheetDeleteRow,
  buildSheetRow,
  nextRowNode,
  type WriteScope,
} from "./builders.js";

const scope: WriteScope = { roots: [SYNTHETIC_ROOT], extraProperties: ["acmeTeaser"] };
const PAGE = `${SYNTHETIC_ROOT}/en/outdoor-gear`;
const SHEET = `${SYNTHETIC_ROOT}/metadata`;
const OUTSIDE = "/content/acme-demo-site-us/en";

describe("buildSetProperties", () => {
  it("encodes strings, lists, booleans and removals with client-emitted operators only", () => {
    expect(buildSetProperties(scope, { path: PAGE, set: { "jcr:title": "Gear", "cq:tags": ["a", "b"], hideInNav: true, acmeTeaser: "t" }, remove: ["navTitle"] })).toEqual({
      method: "POST",
      path: `${PAGE}/jcr:content`,
      form: [
        ["jcr:title", "Gear"],
        ["cq:tags", "a"],
        ["cq:tags", "b"],
        ["cq:tags@TypeHint", "String[]"],
        ["hideInNav", "true"],
        ["hideInNav@TypeHint", "Boolean"],
        ["acmeTeaser", "t"],
        ["navTitle@Delete", ""],
        ["_charset_", "utf-8"],
      ],
      label: `page properties of ${PAGE}`,
    });
  });

  it("refuses a smuggled operator, a structural property and an unlisted one", () => {
    expect(() => buildSetProperties(scope, { path: PAGE, set: { "jcr:title@MoveFrom": "/content/x" } })).toThrow(ForbiddenPropertyNameError);
    expect(() => buildSetProperties(scope, { path: PAGE, set: { "sling:resourceType": "x" } })).toThrow(ForbiddenPropertyNameError);
    expect(() => buildSetProperties(scope, { path: PAGE, remove: [":operation"] })).toThrow(ForbiddenPropertyNameError);
    expect(() => buildSetProperties(scope, { path: PAGE, set: { acmeOther: "x" } })).toThrow(ForbiddenPropertyNameError);
  });

  it("refuses paths outside the roots or outside the grammar, and empty changes", () => {
    expect(() => buildSetProperties(scope, { path: OUTSIDE, set: { "jcr:title": "x" } })).toThrow(PathOutsideWriteRootsError);
    expect(() => buildSetProperties(scope, { path: `${SYNTHETIC_ROOT}/../acme-demo-site-us`, set: { "jcr:title": "x" } })).toThrow(InvalidAemPathError);
    expect(() => buildSetProperties(scope, { path: PAGE })).toThrow(/Nothing to change/);
    expect(() => buildSetProperties(scope, { path: PAGE, set: { "jcr:title": "x" }, remove: ["jcr:title"] })).toThrow(/both set and removed/);
  });
});

describe("buildSetRobots", () => {
  it("writes the page-metadata robots text field, or deletes it", () => {
    expect(buildSetRobots(scope, PAGE, ["noindex", "nofollow"]).form).toEqual([
      ["robots", "noindex, nofollow"],
      ["_charset_", "utf-8"],
    ]);
    expect(buildSetRobots(scope, PAGE, null).form).toEqual([
      ["robots@Delete", ""],
      ["_charset_", "utf-8"],
    ]);
    expect(() => buildSetRobots(scope, PAGE, ["none"])).toThrow(InvalidPropertyValueError);
  });
});

describe("sheet builders", () => {
  it("creates a sheet from the EDS metadata template (field-proven shape)", () => {
    expect(buildCreateSheet(scope, SHEET)).toEqual({
      method: "POST",
      path: "/bin/wcmcommand",
      form: [
        ["cmd", "createPage"],
        ["_charset_", "utf-8"],
        ["parentPath", SYNTHETIC_ROOT],
        ["label", "metadata"],
        ["title", "metadata"],
        ["template", "/libs/core/franklin/templates/metadata"],
      ],
      label: `create the sheet ${SHEET}`,
    });
  });

  it("sets columns as String[]", () => {
    expect(buildSheetColumns(scope, SHEET, ["URL", "Robots"]).form).toEqual([
      ["columns", "URL"],
      ["columns", "Robots"],
      ["columns@TypeHint", "String[]"],
      ["_charset_", "utf-8"],
    ]);
  });

  it("adds, updates and deletes rows", () => {
    expect(buildSheetRow(scope, SHEET, "row", { URL: "/**", Robots: "noindex, nofollow" }, true)).toEqual({
      method: "POST",
      path: `${SHEET}/jcr:content/row`,
      form: [
        ["jcr:primaryType", "nt:unstructured"],
        ["URL", "/**"],
        ["Robots", "noindex, nofollow"],
        ["_charset_", "utf-8"],
      ],
      label: `add row row of ${SHEET}`,
    });
    expect(buildSheetRow(scope, SHEET, "row0", { Robots: "" }, false).form).toEqual([
      ["Robots@Delete", ""],
      ["_charset_", "utf-8"],
    ]);
    expect(buildSheetDeleteRow(scope, SHEET, "row0").form).toEqual([
      [":operation", "delete"],
      ["_charset_", "utf-8"],
    ]);
  });

  it("refuses an operator in a column name or a bad row node", () => {
    expect(() => buildSheetRow(scope, SHEET, "row", { "URL@MoveFrom": "/x" }, true)).toThrow(ForbiddenPropertyNameError);
    expect(() => buildSheetRow(scope, SHEET, "../x", { URL: "/x" }, true)).toThrow(/row node/);
    expect(() => buildSheetColumns(scope, SHEET, [":operation"])).toThrow(ForbiddenPropertyNameError);
  });

  it("picks row node names in the field CLI's order", () => {
    expect(nextRowNode([])).toBe("row");
    expect(nextRowNode(["row"])).toBe("row0");
    expect(nextRowNode(["row", "row0", "row2"])).toBe("row1");
  });
});

describe("buildReplicate", () => {
  it("uses query parameters and selects the preview agent with type=preview", () => {
    expect(buildReplicate(scope, PAGE, "Activate", "preview")).toEqual({
      method: "POST",
      path: `/bin/replicate?cmd=Activate&path=${encodeURIComponent(PAGE)}&type=preview`,
      form: [],
      label: `publish ${PAGE} (preview)`,
    });
    expect(buildReplicate(scope, PAGE, "Deactivate", "publish").path).toBe(`/bin/replicate?cmd=Deactivate&path=${encodeURIComponent(PAGE)}`);
    expect(() => buildReplicate(scope, OUTSIDE, "Activate", "publish")).toThrow(PathOutsideWriteRootsError);
  });
});

describe("page lifecycle builders", () => {
  it("creates a page from a template under /conf, /libs or /apps", () => {
    expect(buildCreatePage(scope, { parentPath: `${SYNTHETIC_ROOT}/en`, name: "tents", title: "Tents", template: "/conf/acme/settings/wcm/templates/page" }).form).toContainEqual([
      "template",
      "/conf/acme/settings/wcm/templates/page",
    ]);
    expect(() => buildCreatePage(scope, { parentPath: `${SYNTHETIC_ROOT}/en`, name: "a.b", title: "x", template: "/conf/acme/t" })).toThrow(/page name/);
    expect(() => buildCreatePage(scope, { parentPath: `${SYNTHETIC_ROOT}/en`, name: "a", title: "x", template: "/content/acme/t" })).toThrow(/template path/);
  });

  it("copies and moves only inside the roots, never into itself", () => {
    expect(buildCopyPage(scope, { srcPath: PAGE, destParentPath: `${SYNTHETIC_ROOT}/fr`, destName: "outdoor-gear", shallow: false }).form).toContainEqual(["cmd", "copyPage"]);
    expect(() => buildCopyPage(scope, { srcPath: PAGE, destParentPath: OUTSIDE, destName: "x", shallow: true })).toThrow(PathOutsideWriteRootsError);
    expect(() => buildMovePage(scope, { srcPath: PAGE, destParentPath: `${PAGE}/sub`, destName: "x" })).toThrow(/into itself/);
    expect(buildMovePage(scope, { srcPath: PAGE, destParentPath: `${SYNTHETIC_ROOT}/fr`, destName: "x" }).form).toContainEqual(["cmd", "movePage"]);
  });

  it("deletes with force=false and never a whole root", () => {
    expect(buildDeletePage(scope, PAGE).form).toEqual([
      ["cmd", "deletePage"],
      ["_charset_", "utf-8"],
      ["path", PAGE],
      ["force", "false"],
    ]);
    expect(() => buildDeletePage(scope, SYNTHETIC_ROOT)).toThrow(/write root/);
  });
});
