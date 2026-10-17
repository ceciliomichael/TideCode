# tools.available.search.search

Find authorized tools by capability, keyword, exact name, or MCP server namespace. Searching an exact server namespace lists its matching authorized tools, ten per page by default. Use `namespace: "github", query: "issues"` to search only GitHub tools, or `namespace: "mcp"` to search across MCP tools. Optional `query`, `namespace`, `limit`, `offset`. Results are Markdown with exact callable names, namespace, and continuation instructions, never contracts. Prefer `tools.available.list` for browsing available native tools and MCP server namespaces.
