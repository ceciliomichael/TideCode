# tools.available.get

Retrieve the complete contract for exactly one authorized API. Call `tools.available.get({ name: "tools.read" })` for a known native tool. For MCP tools, first discover the exact name using `tools.available.search({ query: "...", namespace: "mcp" })`, then call get using that exact returned name. Get returns the complete description/instructions, callable signature, and input schema. You must get a tool before calling it; the retrieved contract remains valid during the current chat runtime only. Get does not grant permissions beyond the host registry.
