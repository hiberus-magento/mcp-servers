## 1. mcp-core

- [x] 1.1 RED → GREEN: `readHttpConfig` (off without a port, port range, required and trimmed token, lists, token never in an error)
- [x] 1.2 RED → GREEN: `startHttpEndpoint` (401, 403 Host/Origin, 404, 405 with `Allow: POST`, 413, generic 500, loopback bind, case-insensitive scheme)
- [x] 1.3 RED → GREEN: access-log line, no arguments or token, no forged lines; reply stream cancelled when the client leaves; `close(graceMs)` lets requests in flight finish

## 2. Servers

- [x] 2.1 RED → GREEN: `magento-rest` and `magento-graphql` on the built bundle: same read tools as stdio, no session header, stdout empty, refuses to start without a valid token, 405 on `GET`, exits 0 on `SIGTERM`/`SIGINT`
- [x] 2.2 RED → GREEN: `magento-graphql` leaves the tools the store lacks out of every request after the schema is read (D14 over HTTP)

## 3. Docs and verification

- [x] 3.1 `servers.json` (five variables each), READMEs, `docs/http-mode.md`, changeset
- [x] 3.2 The 8 verification commands pass (the startup-CPU budget fails on every server, changed or not, on a loaded machine; confirm in CI)
- [x] 3.3 `curl` against both bundles and a loopback fake store: tool call 200, every status in the guide, access log, exit 0 on `SIGTERM`; the SDK's own HTTP client makes one `GET` and no reconnects
