# HTTP mode

How to run `magento-rest` and `magento-graphql` as a small HTTP service, and how a backend (a PHP
middleware, a queue consumer, a script) calls it. Read this if the caller **cannot own a child process**.
If a desktop client such as Claude Code launches the server for you, you want stdio, which is the default
and needs none of this.

**In short.** Set `<PREFIX>_HTTP_PORT` and `<PREFIX>_HTTP_TOKEN` and the server stops speaking stdio and
listens on `http://127.0.0.1:<port>/mcp`. Each tool call is one `POST` carrying a JSON-RPC message and an
`Authorization: Bearer` header. There is no session and no handshake: every request stands alone.
`<PREFIX>` is `MAGENTO_GRAPHQL` or `MAGENTO_REST`; everything below applies to both.

## 1. Start it

```sh
export MAGENTO_GRAPHQL_BASE_URL=https://demo-host.example-domain/graphql
export MAGENTO_GRAPHQL_HTTP_PORT=3100
export MAGENTO_GRAPHQL_HTTP_TOKEN="$(openssl rand -hex 32)"   # keep it: callers must send it

npx --package @hiberus-magento/magento-graphql hiberus-magento-graphql-mcp
# [INFO] magento-graphql: listening on http://127.0.0.1:3100/mcp
```

| Variable | Meaning |
|---|---|
| `<PREFIX>_HTTP_PORT` | Turns HTTP mode on. Unset or blank: stdio, exactly as before. `0` picks a free port, printed in the line above. |
| `<PREFIX>_HTTP_TOKEN` | Required with a port. At least 32 characters, otherwise the server exits with code 1. Environment only: there is no flag for it, so it never reaches shell history or `ps`. |
| `<PREFIX>_HTTP_HOST` | Interface to bind. Default `127.0.0.1` (this machine only). |
| `<PREFIX>_HTTP_ALLOWED_HOSTS` | Extra `Host` header values to accept, comma-separated, e.g. `magento-graphql:3100`. |
| `<PREFIX>_HTTP_ALLOWED_ORIGINS` | `Origin` values to accept. Leave unset: this server is for backends, not browsers. |

The server's usual variables still apply (`MAGENTO_GRAPHQL_BASE_URL`, the Magento token, `…_ALLOW_WRITES`,
`…_GROUPS`; see the package README). Everything is read once at startup, so changing any of it, the token
included, means restarting the process.

## 2. Call it

Three headers are required on every request, and the body is JSON-RPC 2.0:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <the token>` |
| `Content-Type` | `application/json` |
| `Accept` | `application/json, text/event-stream` (both, even though the reply is always JSON) |

```sh
URL=http://127.0.0.1:3100/mcp
HEADERS=(-H "Authorization: Bearer $MAGENTO_GRAPHQL_HTTP_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

# What tools exist (name, description, inputSchema, annotations)
curl -s "$URL" "${HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Run one
curl -s "$URL" "${HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"magentographql_get_store_config","arguments":{}}}'
```

- **No `initialize` first, no session header.** Call `tools/list` or `tools/call` directly. Only `POST` is
  served; `GET` and `DELETE` answer `405`, which is how a standard MCP client learns there is no stream.
- **`tools/list`** returns each tool's `inputSchema` (JSON Schema) and `annotations.readOnlyHint`, which is
  what a caller needs to describe the tool to a model and to tell reads from writes.
- **`tools/call`** takes `name` and `arguments`. A success looks like
  `{"result":{"content":[{"type":"text","text":"…"}]},"jsonrpc":"2.0","id":2}`; hand `content[].text` to the model.
- Replies are plain JSON, never a stream.

## 3. Reading the answer

**A tool that fails is not an HTTP error.** It comes back as HTTP `200` with `"isError": true` and the reason
in `content[0].text`. That text is written to be read by the model. A real one, with the base URL unset:

```json
{"result":{"content":[{"type":"text","text":"Unexpected error: MAGENTO_GRAPHQL_BASE_URL is required: the Magento GraphQL endpoint, e.g. https://<host>/graphql. Set it and restart."}],"isError":true},"jsonrpc":"2.0","id":2}
```

HTTP statuses are for the transport and for security, and never carry Magento data:

| Status | Cause |
|---|---|
| `401` | Token missing or wrong. |
| `403` | `Host` or `Origin` not allowed. See "From another container". |
| `404` | Any path other than `/mcp`. |
| `405` | Any method other than `POST` (the reply carries `Allow: POST`). |
| `406` | The `Accept` header lacks `application/json, text/event-stream`. The body says so. |
| `413` | Request body over 1 MiB. |
| `415` | `Content-Type` is not `application/json`. |
| `400` | The body is not valid JSON (a JSON-RPC parse error). |
| `500` | Unexpected failure. The body is generic; the detail goes to the server's stderr. |

A JSON-RPC problem (unknown method, invalid arguments) is a JSON-RPC `error` object, also with HTTP `200`,
not a tool result: `{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"Method not found"}}`.

## 4. Which tools the caller sees

- **Reads only by default.** Write tools are not registered unless the server runs with
  `<PREFIX>_ALLOW_WRITES=true`; without it they are absent from `tools/list`, not refused on call. Keep a
  service that backs a chatbot read-only until there is a confirmation step in front of the writes.
- **Fewer tools, cheaper prompts.** `magento-graphql` lists 65 tools read-only and 247 with writes on;
  `magento-rest` lists 60 and 93. `<PREFIX>_GROUPS=products,cms` limits the server to those groups, and
  the caller should still hand each agent only the few tools it needs.
- **List once, again after the first call (`magento-graphql`).** The first tool call reads the store's
  schema, and from then on the tools whose operation the store lacks (B2B on an open-source store, say)
  are left out of `tools/list`. HTTP has no stream to announce that on, so list again after that first
  call; otherwise the list changes only when the server restarts. Cache it instead of listing per call.

## 5. Deploying it

- **Internal network only.** It speaks plain HTTP (no TLS) behind a shared secret. Never publish the port to
  the internet; if traffic must cross networks, put a TLS proxy in front.
- **From another container.** The defaults accept only loopback. To reach it as `http://magento-graphql:3100`,
  bind outward and name the host callers use, otherwise they get `403`:

  ```sh
  MAGENTO_GRAPHQL_HTTP_HOST=0.0.0.0
  MAGENTO_GRAPHQL_HTTP_ALLOWED_HOSTS=magento-graphql:3100
  ```

- **The token is a secret.** Pass it through the deployment's secret mechanism, not a committed file, and
  never log it. It is compared in constant time and never echoed back, including in error replies.
  Surrounding whitespace is trimmed, so a secret file's trailing newline is harmless.
- **Stopping it.** `SIGTERM` or `SIGINT` stops accepting requests, gives the ones in flight 5 seconds, and
  exits `0`, inside Docker's default 10-second stop timeout.
- **The access log.** Each request writes one line to stderr, for example
  `[INFO] http: POST /mcp 200 tools/call magentographql_get_store_config 42ms`: method, path, status,
  JSON-RPC method, tool name and duration. Never headers, the token, arguments or results. Refusals are
  `[WARN]`, failures `[ERROR]`.
- **Run one process per store.** The Magento credential is fixed for the life of the process, so a service
  talks to exactly one store. For two stores, run two services on two ports.

## 6. What to know before building on it

- **Identity is the server's, not the end user's.** Every call runs with the credential in the server's
  environment. A caller cannot make a call "as customer X"; passing a customer id in `arguments` does not
  change who Magento believes is asking. Use `magento-rest` (an integration token) only for back-office
  work. A customer-facing assistant would need a per-call customer token, which this mode does not offer.
- **Nothing is kept between calls.** Anything that must survive (a cart id, say) lives in Magento or in the
  caller; pass it back in `arguments`.
- **Set a timeout on the caller.** Each request to Magento gives up after 30 seconds, and a read that hits
  a `429` or `5xx` is retried, so a tool call can take longer than that. Hanging up does not stop a call
  already under way. Give the HTTP client its own timeout, shorter than the one the surrounding system
  imposes on a tool.
- **Cost per call.** Each request builds a fresh MCP server and registers its tools before answering. With
  all 247 `magento-graphql` tools (writes on) that is more work than with a few groups; load fewer groups
  if latency matters.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Server exits with `…_HTTP_TOKEN is required` | Port set, token not. |
| Server exits with `at least 32 characters` | The token is shorter than 32 characters. |
| Server prints nothing and waits on stdin | `…_HTTP_PORT` is unset, so it started in stdio mode. |
| `401` | Wrong or missing `Authorization: Bearer …`, or the server was restarted with a different token. |
| `403` from another container | `…_HTTP_HOST` is still loopback, or `…_HTTP_ALLOWED_HOSTS` does not list the exact `host:port` the caller uses. |
| `406` | Add `Accept: application/json, text/event-stream`. |
| `200` with `isError: true` naming a variable | The server is up; its Magento configuration is missing or wrong. |
