---
"@hiberus-magento/magento-graphql": minor
---

First release of `@hiberus-magento/magento-graphql`: an MCP server (`hiberus-magento-graphql-mcp`) and operator CLI (`hiberus-magento-graphql`) for the Magento 2 / Adobe Commerce GraphQL API. Query tools are registered by default; mutation tools only when `MAGENTO_GRAPHQL_ALLOW_WRITES=true`. A response whose requested fields are all null with errors (Magento's usual failure shape, e.g. a customer query without a token or a failed mutation) is reported as an error with its remedy, and every request attempt is bounded by a timeout. A tool call the MCP client cancels aborts its in-flight request.
