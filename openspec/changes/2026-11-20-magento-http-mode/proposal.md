# Proposal: HTTP mode for `magento-rest` and `magento-graphql`

## Why

Every server in this repository speaks MCP over stdio: the client launches it as a child process.
A PHP middleware in front of a Magento store, or a queue consumer, cannot own a child process per
request, so it could not use `magento-rest` or `magento-graphql` at all. It needs to reach a
long-running server over the network.

## What Changes

- `mcp-core` gains `readHttpConfig` (reads the opt-in from the environment) and
  `startHttpEndpoint` (a Node `http` bridge that authenticates and screens every request and hands a
  web-standard `Request` to a handler). Neither imports the MCP SDK.
- `magento-rest` and `magento-graphql` serve MCP over stateless Streamable HTTP at `/mcp` when
  `<PREFIX>_HTTP_PORT` is set, with `<PREFIX>_HTTP_TOKEN` as a bearer secret. Without the port they
  start in stdio exactly as before.
- `docs/http-mode.md`, linked from both READMEs and the manifest.

## Out of scope

Sessions and SSE streams, TLS (put a proxy in front), per-call end-user identity (every call uses
the server's Magento credential), and HTTP mode for the other servers.

## Rollback

The mode is opt-in and read once at startup. Unsetting `<PREFIX>_HTTP_PORT` returns a deployment to
stdio; reverting the two commits removes it without touching the stdio path.

## Impact

- `packages/mcp-core/src/http/`, `packages/magento-rest/src/mcp.ts`, `packages/magento-graphql/src/mcp.ts`.
- `servers.json` (five variables per server), both READMEs, `docs/http-mode.md`.
- Specs: `mcp-core` (new requirement: Opt-in HTTP Endpoint).
