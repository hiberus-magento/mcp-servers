# @hiberus-magento/fixture-server

An MCP (Model Context Protocol) server for the `testing` domain.

**Scaffold — rewrite this paragraph before publishing.** Say what this package
is and which product it talks to. If that product's name is one of the adjacent
Adobe acronyms (EDS / ACS / ACO), say which one it is *not*: they are routinely
confused. This is the page a stranger lands on from npm, so write it for
someone who has never seen this repository.

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

## The binaries

| Binary | What it is |
| --- | --- |
| `fixture-server` | The **stdio MCP server**. This is what you put in an MCP client's configuration. It speaks JSON-RPC on stdout and nothing else. |

If this package grows an operator CLI alongside the server, list it here too
and say which is which. With two binaries declared, `npx` has to be told which
one to run (`npx -y --package <pkg> <bin>`); the bare `npx -y <pkg>` form exits
with `could not determine executable to run`.

The section between the markers below is generated from `servers.json` by
`scripts/gen-readme.mjs`. Do not hand-edit it — `node scripts/gen-readme.mjs --check`
fails if it is stale. Everything outside the markers is preserved verbatim.

<!-- package:start -->
<!-- package:end -->

## Credentials

**Scaffold — rewrite this section before publishing.** State where the
credential comes from, how to supply it, and what happens when it is absent. If
this server uses `mcp-core`'s credential store, say that
`$XDG_CONFIG_HOME/hiberus/testing.json` at file mode `0600` is an
alternative to putting a secret in any config file or shell variable.

## What this server deliberately does not do

**Scaffold — rewrite this section before publishing.** List the operations that
have no MCP tool and will not get one, and why. Someone deciding whether to
install this needs the boundary stated, not implied.

## Documentation

- [Repository](https://github.com/hiberus-magento/mcp-servers) — source, issues, and the other servers in this family.
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md) — where MCP client configuration lives, and which file must never hold a secret.

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
