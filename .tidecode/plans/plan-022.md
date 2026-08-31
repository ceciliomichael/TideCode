---
status: draft
---

# Fix packaged MCP discovery

Goal: make connected MCP tools available to Code Mode in the packaged run-service, which runs under bundled Node rather than Electron. Root cause: mcpRegistryTools.ts returns an empty tool set whenever process.versions.electron is absent, so packaged run-service searches always see zero MCP tools. Change: recognize the TideCode run-service runtime (using its existing build-id environment marker) as a valid server runtime while preserving the guard against arbitrary plain-Node test/import contexts. Add focused regression coverage for packaged run-service detection and MCP registry loading. Verify with targeted MCP/Code Mode tests, typecheck, and lint.
