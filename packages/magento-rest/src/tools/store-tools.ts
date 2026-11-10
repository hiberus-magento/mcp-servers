// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Store configuration tools: six reads, ported from the original
// `src/tools/store.js`. None takes an argument. Each projects through an
// allowlist, so a Magento instance's extension attributes (and anything a
// module adds to a store config) do not reach the model.
import { z } from "zod";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";

const noInput = z.object({}).strict();

export function storeTools({ readTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_store_configs",
      description: "Use this to read each store view's configuration: code, locale, base currency, timezone, weight unit and base URLs.",
      input: noInput,
      shape: shapes.store_config,
      run: (_args, client) => client.get("/store/storeConfigs"),
    }),
    readTool({
      name: "magentorest_get_store_views",
      description: "Use this to list every store view with its code, name, website, store group and whether it is active.",
      input: noInput,
      shape: shapes.store_view,
      run: (_args, client) => client.get("/store/storeViews"),
    }),
    readTool({
      name: "magentorest_get_websites",
      description: "Use this to list every website with its code, name and default store group.",
      input: noInput,
      shape: shapes.website,
      run: (_args, client) => client.get("/store/websites"),
    }),
    readTool({
      name: "magentorest_get_store_groups",
      description: "Use this to list every store group with its website, root category and default store view.",
      input: noInput,
      shape: shapes.store_group,
      run: (_args, client) => client.get("/store/storeGroups"),
    }),
    readTool({
      name: "magentorest_get_countries",
      description: "Use this to list the countries Magento knows, with ISO codes, English names and their regions.",
      input: noInput,
      shape: shapes.country,
      run: (_args, client) => client.get("/directory/countries"),
    }),
    readTool({
      name: "magentorest_get_currency_info",
      description: "Use this to read the base and display currency, the available currency codes and the exchange rates.",
      input: noInput,
      shape: shapes.currency,
      run: (_args, client) => client.get("/directory/currency"),
    }),
  ];
}
