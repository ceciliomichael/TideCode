---
status: draft
---

# Fix MCP first-load and restart auto-connect

Goal: ensure enabled MCP servers with saved autoConnect=true reconnect on the first session sync after app launch and in fresh workspace-specific chat sessions, so Code Mode immediately catalogs their tools. Changes: update electron/mcp/serverManager.ts first-runtime branch to connect immediately when enabled+autoConnect; add regression coverage for initial auto-connect after a fresh manager/session load and tool availability. Verification: focused MCP regression test(s), relevant Code Mode tool-search tests, and typecheck if needed. Scope: no unrelated MCP UI or protocol changes.
