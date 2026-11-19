# Proposal: `magento-graphql`

## Why

`magento-rest` covers the Magento 2 **admin/integration** REST API. Headless and PWA-style
storefronts (Hyvä, PWA Studio, Adobe Commerce storefronts) talk to Magento through **GraphQL**
instead, and a lot of useful questions are answered only there: what the storefront sees for a
product or category, how a URL resolves, what a cart holds, what a signed-in customer sees.
This package gives an agent that view, with the same safety posture as `magento-rest`.

## What

A new package `@hiberus-magento/magento-graphql` (domain `magento-graphql`, tool prefix
`magentographql_`, environment prefix `MAGENTO_GRAPHQL_`), a CLI for the one credential and an
MCP server, with:

- **Curated tools** with fixed query documents: products, categories, CMS, store, customer, cart.
- **A generic `query` tool** that runs one read-only GraphQL query, and a **schema** tool for
  introspection, so the curated set is a convenience and not a ceiling.
- **Anonymous by default.** The storefront schema is public; an optional *customer* token
  (never an argument, never argv) unlocks the customer tools.
- **Mutations** — every one the core schema has, about 150 — only behind `MAGENTO_GRAPHQL_ALLOW_WRITES=true`, not registered otherwise.

## Out of scope

Subscriptions, deprecated operations, and anything under the admin REST API (that is `magento-rest`).
(Placing orders, creating customers and minting tokens were out of scope until 2026-11-05, when the user asked for
every operation; see D11.)

## Decisions taken with the user (2026-11-05)

Curated tools plus a generic query tool; anonymous with an optional customer token; mutations
behind a write switch.
