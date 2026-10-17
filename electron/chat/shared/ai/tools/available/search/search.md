# tools.available.search

Find authorized tools by capability, keyword, or exact name. Parameters: `query?`, `namespace?`, `limit?`, `offset?`. Use `namespace: "mcp"` to find connected MCP names; `namespace: "native"` to search native tools. Results contain **only** exact callable names plus pagination, not schemas or descriptions. Call `tools.available.get({name})` before executing a result. Native names are already shown in the compact exec catalog; MCP names are not preloaded.
