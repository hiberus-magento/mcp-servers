---
"@hiberus-magento/magento-rest": patch
---

An argument a tool's schema refuses (an out-of-range ID, a filter field not on the tool's list, an unknown input) is now answered with the typed error every other failure carries: `structuredContent.error` with `code: "invalid_argument"` and `argument` naming it (`order_id`, `filters.0.field`, ...). Before, the MCP SDK refused it first with a plain-text "MCP error -32602" and no typed error. The tool list a host sees is unchanged.
