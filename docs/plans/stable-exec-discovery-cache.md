# Plan: Stable exec discovery for prompt-cache reuse

Status: FINAL DRAFT FOR APPROVAL. No implementation yet.

## Goal
Keep the system prompt and provider-facing exec tool definition byte-stable across Plan and Agent/Builder modes, reducing prompt-prefix churn and initial tokens. Keep authorization, tool validation, and mode transition behavior intact. Provider cache hits cannot be guaranteed.

## Confirmed current behavior
- Shared system prompt is assembled identically for both modes in electron/chat/shared/prompts/mode/index.ts.
- src/lib/hiddenUserContext.ts injects mode-specific instructions in the next user message only when the mode changes.
- electron/chat/shared/tools/factory.ts builds different tool registries by mode. Plan includes inspection, optional skills, plan.create and plan-only patch. Agent includes inspection, optional skills, terminal.*, patch, write and connected MCP, not plan.create.
- electron/chat/shared/ai/exec/exec.ts embeds mode-dependent native tool names in the provider-facing exec description. This breaks tool-description stability when the mode or enabled skills change.
- Runtime discovery in codeMode/v2/toolRuntime.ts currently exposes available.search and available.get. Get returns Markdown. MCP names require search first. Discovery state is keyed by conversation/workspace/mode/execution in ai/registry/sessionDiscovery.ts.

## Proposed design
1. Expose ONLY these discovery signatures in the fixed exec description: tools.available.list({page?:number}); tools.available.search({query?,namespace?,limit?,offset?}); tools.available.get({name:string}). Include brief discovery guidance, with no other native tool names or schemas in the initial exec tool description. Other tools remain callable inside exec after discovery and contract retrieval. The fixed provider-facing exec name, schema, description and ordering must be identical across modes.
2. Add tools.available.list. Default to page 1, 10 lexically sorted native names per page, only currently authorized tools. Return exact names and compact pagination (page, hasMore). Page 2 continues native names when present. Do NOT force page 2 to be MCP: MCP remains search-only to avoid flooding prompt context and preserve existing MCP discovery gating. Enabled skill tools can join native pages if available. Out-of-range pages return empty results. Calling list does not obtain any contracts.
3. Search remains names-only and filters by current registry. Get remains Markdown-first and only succeeds for authorized tools; MCP still requires prior search. The model can get an exact known native name directly without listing, saving a discovery round-trip. Automatic missing-get recovery remains supported.
4. Keep Plan and Agent system prompt exactly the same. Use the existing late user-message hidden context for mode transitions. Plan -> Agent: say the current catalog may now include source editing and terminal; plan.create is unavailable; refresh list/search for current-mode capabilities. Agent -> Plan: say write, terminal and MCP are unavailable; read-only inspection, plan.create and restricted plan patch remain. Older hidden mode contexts are superseded by the newest. Avoid copying tool catalogs or generic instructions into hidden context.
5. Security stays host-enforced: registry gates every tool; obtained contracts and discovered MCP names are isolated by mode, workspace and permission settings. No stale Plan or Agent permissions leak across mode changes. Do not enable terminal in Plan as part of this request.
6. Tool UI shows Listed tools for list, Searched tools for search, and one Retrieved <tool name> contract per get, even for multiple gets in one exec. Group summaries reflect actual nested discovery calls, not a generic Ran code.

## Example
Plan list page 1 (illustrative): tools.glob, tools.grep, tools.list, tools.patch, tools.plan.create, tools.read. Enabled skills may add entries. No write, terminal or MCP.
Agent list page 1 (illustrative, sorted): tools.glob, tools.grep, tools.list, tools.patch, tools.read, tools.terminal.execute, tools.terminal.interact, tools.terminal.read, tools.terminal.terminate, tools.write. MCP tools are discovered by search. More native entries appear on later pages.

## Implementation and verification sequence
1. Capture baseline serialized system prompt and provider tool definitions for identical workspace/provider across modes, including provider-native web tool availability. Measure text/token sizes and stable common prefix.
2. Implement deterministic native listing, safe paging and nested receipts; ensure no MCP names are exposed through list.
3. Remove registry-dependent name lists from exec description. Add only fixed list/search/get signatures and concise instructions. Keep external exec input schema stable.
4. Update current mode transition hidden user context to request refresh and clearly revoke reliance on previous-mode catalog without adding a mode-specific system prompt.
5. Preserve authorization and per-mode discovery cache boundaries. Test known-native direct get, MCP search-first, unavailable names, and switching Plan <-> Agent repeatedly.
6. Extend UI presentation and grouping tests; regression-test list/search/get and multiple contracts in one exec.
7. Run typecheck, focused tests, CLI packaging and production build. Compare prompt sizes and provider-reported cached tokens where available; report actual savings or lack thereof rather than assuming improvement.

## File-by-file operations
CREATE electron/chat/shared/ai/tools/available/list/list.ts: deterministic names-only native pagination.
CREATE electron/chat/shared/ai/tools/available/list/list.md: minimal list instructions.
MODIFY electron/chat/shared/codeMode/v2/toolRuntime.ts: list dispatch, receipt, registry filtering and permission tests.
MODIFY electron/chat/shared/ai/exec/exec.ts: fixed discovery-only tool description independent of mode and enabled skills.
MODIFY electron/chat/shared/ai/exec/exec.md: concise lazy-discovery guidance.
MODIFY electron/chat/shared/ai/registry/documentation.ts: register list documentation.
MODIFY src/lib/hiddenUserContext.ts: compact accurate mode transition and catalog refresh instructions.
MODIFY src/components/chat/toolInvocationDiscoveryPresentation.ts: named list receipt UI.
MODIFY src/components/chat/toolInvocationGrouping.ts: list counting/summary.
MODIFY tests/codex/execNativeTools.test.ts: listing, permission, mode and caching regression.
MODIFY tests/codex/agentTools.test.ts: stable exec metadata and availability tests.
MODIFY tests/codex/toolInvocationPresentation.test.ts: new list and multi-retrieval presentation.
MODIFY tests/codex/toolInvocationGrouping.test.ts: listing summary.
MODIFY ARCHITECTURE.md and DESIGN.md: updated current architecture after implementation.
REVIEW ONLY unless necessary: electron/chat/shared/prompts/mode/index.ts, electron/chat/shared/messages.ts, electron/chat/shared/tools/factory.ts, electron/chat/shared/ai/registry/sessionDiscovery.ts and provider request/transport files. Disclose any material scope increase for approval.

## Expected affected tree
electron/chat/shared/ai/exec/{exec.ts,exec.md} [modify]
electron/chat/shared/ai/registry/documentation.ts [modify]
electron/chat/shared/ai/tools/available/list/{list.ts,list.md} [create]
electron/chat/shared/codeMode/v2/toolRuntime.ts [modify]
src/lib/hiddenUserContext.ts [modify]
src/components/chat/{toolInvocationDiscoveryPresentation.ts,toolInvocationGrouping.ts} [modify]
tests/codex/{execNativeTools.test.ts,agentTools.test.ts,toolInvocationPresentation.test.ts,toolInvocationGrouping.test.ts} [modify]
ARCHITECTURE.md; DESIGN.md [modify]

## Caveats and acceptance
Stable exec metadata improves the potential cacheable prefix, but provider-native web_search, differing provider/model options, message serialization and changing conversation history can still affect cache hits. Listing may add tool turns and tokens; direct get/search should remain available. Record both cached input tokens and total tokens, latency and cost in comparisons.
Accept only if tool descriptor is byte-identical across modes, each list shows only authorized names, forbidden actions are blocked, no mode-specific prompt rewrite occurs, and tool UI is accurate. No commits or releases unless separately requested.
APPROVAL REQUIRED BEFORE IMPLEMENTATION.
