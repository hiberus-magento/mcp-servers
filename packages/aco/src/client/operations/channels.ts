// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListChannels` — `Q_VIEWS` (exploration.md). Admin track. Backs
// `aco_list_catalog_views` and `provision`'s catalog-view step.
import type { AdminTransport } from "../http.js";
import { parseListChannelsResult, type ListChannelsResult } from "../types.js";

const LIST_CHANNELS_DOCUMENT = `query ListChannels {
  channels {
    channelId
    name
    scopes {
      locale
    }
    defaultPriceBookId
    policyIds
    protectionEnabled
  }
}`;

export async function listChannels(transport: AdminTransport): Promise<ListChannelsResult> {
  return transport.execute({
    track: "admin",
    document: LIST_CHANNELS_DOCUMENT,
    parse: (data) => parseListChannelsResult(data, "ListChannels"),
  });
}
