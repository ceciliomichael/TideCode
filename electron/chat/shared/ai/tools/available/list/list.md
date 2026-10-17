# tools.available.list

List authorized tools by namespace, ten names per page, with Markdown continuation instructions. `namespace: "native"` (default) lists TideCode tools; `namespace: "mcp"` lists connected MCP server namespaces; `namespace: "github"` lists GitHub server tools. `page` is 1-based within the namespace. Listing an MCP tool authorizes retrieval of its contract through `tools.available.get`. Only mode-authorized tools appear.
