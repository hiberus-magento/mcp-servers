// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Builds Magento's `searchCriteria[...]` query string. Values go through
// `URLSearchParams`, so a value can never become a second parameter; names
// that become part of a KEY (`field`, `direction`, `conditionType`) are
// validated against closed shapes instead, because an encoded key is still
// the caller's choice of which criterion to address.
export const CONDITION_TYPES = [
  "eq",
  "neq",
  "like",
  "nlike",
  "in",
  "nin",
  "gt",
  "gteq",
  "lt",
  "lteq",
  "from",
  "to",
  "null",
  "notnull",
  "finset",
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];
export type SortDirection = "ASC" | "DESC";

export interface SearchFilter {
  readonly field: string;
  readonly value: string | number;
  readonly conditionType?: ConditionType;
}

export interface SearchCriteriaInput {
  /** Filters inside one group are OR'd; groups are AND'd (Magento's own semantics). */
  readonly filterGroups?: ReadonlyArray<ReadonlyArray<SearchFilter>>;
  readonly pageSize?: number;
  readonly currentPage?: number;
  readonly sort?: { readonly field: string; readonly direction: SortDirection };
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Magento attribute and column codes: letters, digits, underscore, and a dot
// for joined fields. Nothing that could close a bracket or start a parameter.
export const FIELD_NAME_PATTERN = /^[A-Za-z0-9_.]{1,64}$/;

function assertField(field: string): string {
  if (!FIELD_NAME_PATTERN.test(field)) {
    throw new Error(`searchCriteria: invalid field name ${JSON.stringify(field)}`);
  }
  return field;
}

function assertCondition(conditionType: string): ConditionType {
  if (!(CONDITION_TYPES as readonly string[]).includes(conditionType)) {
    throw new Error(`searchCriteria: unknown condition type ${JSON.stringify(conditionType)}`);
  }
  return conditionType as ConditionType;
}

function assertPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`searchCriteria: pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return pageSize;
}

function assertCurrentPage(currentPage: number): number {
  if (!Number.isInteger(currentPage) || currentPage < 1) {
    throw new Error("searchCriteria: currentPage must be an integer of at least 1");
  }
  return currentPage;
}

/** The query string (no leading `?`). Always carries an explicit page size, so no call is an unbounded list. */
export function buildSearchCriteria(input: SearchCriteriaInput): string {
  const params = new URLSearchParams();

  (input.filterGroups ?? []).forEach((group, groupIndex) => {
    group.forEach((filter, filterIndex) => {
      const base = `searchCriteria[filter_groups][${groupIndex}][filters][${filterIndex}]`;
      params.set(`${base}[field]`, assertField(filter.field));
      params.set(`${base}[value]`, String(filter.value));
      params.set(`${base}[condition_type]`, assertCondition(filter.conditionType ?? "eq"));
    });
  });

  params.set("searchCriteria[pageSize]", String(assertPageSize(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  params.set("searchCriteria[currentPage]", String(assertCurrentPage(input.currentPage ?? 1)));

  if (input.sort !== undefined) {
    if (input.sort.direction !== "ASC" && input.sort.direction !== "DESC") {
      throw new Error(`searchCriteria: invalid sort direction ${JSON.stringify(input.sort.direction)}`);
    }
    params.set("searchCriteria[sortOrders][0][field]", assertField(input.sort.field));
    params.set("searchCriteria[sortOrders][0][direction]", input.sort.direction);
  }

  return params.toString();
}
