# tools.available.list

List authorized namespaces and tools, ten entries per page. With no namespace, show `native` and each connected MCP server namespace. `namespace: "native"` lists TideCode tools and a specific MCP server namespace lists that server's tools. Tool entries have brief purpose descriptions rather than API signatures or parameter schemas. `page` is 1-based within each view. Listing an MCP tool permits subsequent full-contract retrieval with `tools.available.get({ name })`. Follow the returned page continuation when needed.
