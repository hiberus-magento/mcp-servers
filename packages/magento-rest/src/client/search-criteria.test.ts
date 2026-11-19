// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first: the original interpolated `sort_field` / `sort_direction` raw
// into the query string (`orders.js`), so a value containing `&` appended
// extra criteria. Every value here is encoded as data, and every name that
// becomes part of a key is validated, never interpolated.
import { describe, expect, it } from "vitest";
import { buildSearchCriteria } from "./search-criteria.js";

const decode = (query: string): Record<string, string> => Object.fromEntries(new URLSearchParams(query));

describe("buildSearchCriteria", () => {
  it("emits Magento's bracketed filter keys", () => {
    const query = buildSearchCriteria({ filterGroups: [[{ field: "name", value: "%tent%", conditionType: "like" }]] });
    expect(decode(query)).toMatchObject({
      "searchCriteria[filter_groups][0][filters][0][field]": "name",
      "searchCriteria[filter_groups][0][filters][0][value]": "%tent%",
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "like",
    });
  });

  it("defaults the condition type to eq", () => {
    const query = buildSearchCriteria({ filterGroups: [[{ field: "sku", value: "DEMO-TENT-001" }]] });
    expect(decode(query)["searchCriteria[filter_groups][0][filters][0][condition_type]"]).toBe("eq");
  });

  it("numbers groups and filters independently (OR within a group, AND across groups)", () => {
    const query = decode(
      buildSearchCriteria({
        filterGroups: [
          [
            { field: "status", value: "pending" },
            { field: "status", value: "processing" },
          ],
          [{ field: "grand_total", value: 10, conditionType: "gteq" }],
        ],
      }),
    );
    expect(query["searchCriteria[filter_groups][0][filters][1][value]"]).toBe("processing");
    expect(query["searchCriteria[filter_groups][1][filters][0][value]"]).toBe("10");
  });

  it("emits paging and sorting", () => {
    const query = decode(buildSearchCriteria({ pageSize: 20, currentPage: 3, sort: { field: "created_at", direction: "DESC" } }));
    expect(query).toEqual({
      "searchCriteria[pageSize]": "20",
      "searchCriteria[currentPage]": "3",
      "searchCriteria[sortOrders][0][field]": "created_at",
      "searchCriteria[sortOrders][0][direction]": "DESC",
    });
  });

  it("keeps a value containing & as ONE value instead of appending criteria", () => {
    const query = decode(buildSearchCriteria({ filterGroups: [[{ field: "name", value: "x&searchCriteria[pageSize]=9999" }]] }));
    expect(query["searchCriteria[filter_groups][0][filters][0][value]"]).toBe("x&searchCriteria[pageSize]=9999");
    // The injected `pageSize=9999` stayed inside the value; the real page size is the bounded default.
    expect(query["searchCriteria[pageSize]"]).toBe("20");
  });

  it("rejects a sort field that could break out of the key", () => {
    expect(() => buildSearchCriteria({ sort: { field: "id]&x[", direction: "ASC" } })).toThrow(/field/i);
  });

  it("rejects a filter field that could break out of the key", () => {
    expect(() => buildSearchCriteria({ filterGroups: [[{ field: "a&b=c", value: 1 }]] })).toThrow(/field/i);
  });

  it("rejects a sort direction outside ASC/DESC", () => {
    expect(() => buildSearchCriteria({ sort: { field: "id", direction: "ASC&x=1" as "ASC" } })).toThrow(/direction/i);
  });

  it("rejects an unknown condition type", () => {
    expect(() => buildSearchCriteria({ filterGroups: [[{ field: "id", value: 1, conditionType: "drop" as "eq" }]] })).toThrow(/condition/i);
  });

  it("rejects a page size outside 1..100 and a non-integer page", () => {
    expect(() => buildSearchCriteria({ pageSize: 0 })).toThrow(/pageSize/);
    expect(() => buildSearchCriteria({ pageSize: 101 })).toThrow(/pageSize/);
    expect(() => buildSearchCriteria({ currentPage: 1.5 })).toThrow(/currentPage/);
    expect(() => buildSearchCriteria({ currentPage: 0 })).toThrow(/currentPage/);
  });

  it("with no input still asks for an explicit bounded page, never an unbounded list", () => {
    expect(decode(buildSearchCriteria({}))).toEqual({ "searchCriteria[pageSize]": "20", "searchCriteria[currentPage]": "1" });
  });
});
