# TideCode exec-only native tool migration

## Goal
Expose one TideCode-owned provider-facing tool, `exec`, while retaining supported provider-native tools (for example `web_search`). Internal APIs run through a strict hierarchical registry in the existing restricted Code Mode interpreter. Each API has colocated `.ts` and `.md` files.

## Target structure
```
electron/chat/shared/ai/
  exec/exec.ts, exec.md
  registry/registry.ts, contracts.ts, documentation.ts
  tools/
    read/read.ts, read.md
    list/list.ts, list.md
    glob/glob.ts, glob.md
    grep/grep.ts, grep.md
    terminal/{execute,read,interact,terminate}/{name}.ts, {name}.md
    skill/{list,search,load}/{name}.ts, {name}.md
    plan/create/create.ts, create.md
    patch/patch.ts, patch.md
    write/write.ts, write.md
    available/search/search.ts, search.md
  prompts/ (all TideCode-owned chat and worker instructions)
electron/chat/shared/codeMode/v2/ (retain sandboxed interpreter)
```

## Canonical callable APIs
`tools.read`, `tools.list`, `tools.glob`, `tools.grep`, `tools.terminal.execute`, `tools.terminal.read`, `tools.terminal.interact`, `tools.terminal.terminate`, `tools.skill.list`, `tools.skill.search`, `tools.skill.load`, `tools.plan.create`, `tools.patch`, `tools.write`, `tools.available.search`; connected MCP endpoints at exact authorized `tools.mcp.<name>` paths.
Namespaces are never callable dispatchers. Plan Mode allows inspection, skill discovery/loading, plan creation, and patching only the active plan. Agent Mode authorizes terminal and workspace mutations.

## Planned file operations
1. **Create** this plan and `electron/chat/shared/ai/exec/{exec.ts,exec.md}`. **Modify** `electron/chat/shared/tools/{metaTools,factory}.ts` and `electron/chat/shared/codeMode/promptContract.ts` to expose `exec` only and load instruction files without fallbacks.
2. **Create** colocated API `.ts/.md` pairs under `electron/chat/shared/ai/tools/` for the paths above. **Modify** the old implementation files and `electron/chat/shared/tools/{terminalTools,planTools,workspaceTools,index,mcpRegistryTools}.ts` to route to these canonical APIs, preserving stable underlying filesystem/terminal/patch engines.
3. **Modify** `electron/chat/shared/tools/{registry,callableContract}.ts`, `electron/chat/shared/codeMode/v2/{toolRuntime,interpreter}.ts`, `electron/chat/shared/codeMode/{validation,executor}.ts` to support exact nested paths, authorization, strict schemas, accurate callable contracts and on-demand documentation. **Delete** `electron/chat/shared/tools/{skillTool,editTool,workspaceEditTool,mcpTools,planEditTool}.ts`, `electron/chat/shared/orchestration.ts`, `electron/chat/shared/codeMode/toolCallRepair.ts` when dependencies are removed.
4. **Move and centralize** active `electron/chat/shared/prompts/**` into `electron/chat/shared/ai/prompts/`; **modify** prompt consumers `electron/chat/shared/prompts/mode/index.ts`, `electron/chat/shared/runtime.ts`, `electron/chat/shared/runtimeContextUsage.ts`, `src/lib/hiddenUserContext.ts`, `src/lib/{planReview,planPresentation}.ts`, `electron/chat/history/eventStore.ts`, and Git/compaction prompt consumers. Preserve provider-native web search.
5. **Modify** renderer presentation `src/components/chat/{TerminalToolResult,ToolInvocationBlock,toolInvocationGrouping,toolInvocationKinds,toolInvocationPresentation}.*`, `scripts/dumpPromptAndToolsContext.ts`, `electron-builder.json5`, `ARCHITECTURE.md`, `DESIGN.md`.
6. **Modify/add** targeted Code Mode, Plan Mode, MCP, skills, terminal, schema, prompt, renderer and history tests; **remove/update** obsolete direct-mode and edit-only tests.

## Reliability and compatibility rules
- No old provider-facing tools; `exec` plus provider-native tools is the entire provider surface.
- No legacy direct/hybrid runtime, compatibility aliases, silent prompt substitutes, schema-argument stripping or generated name suffixing.
- Keep JSON schema validation, explicit authorization, per-tool execution receipts, truncation, terminal session state, workspace aliases and resource limits.
- Use Code Mode `payloads` for arbitrary exact file/patch text.
- `tools.available.search({query?,namespace?,limit?,offset?})` returns only accessible native/MCP paths, signatures and documentation.
- Preserve historical stored tool records as data, not executable interfaces.
- Preserve all preexisting user changes.

## Verification
Test exact `exec` provider exposure, nested dispatch, strict arguments, all skills, native/MCP discovery, Plan Mode isolation and active plan revision, patch/write fidelity, terminal continuation, packaged Markdown loading, chat presentation and history. Run typecheck, focused tests and build. Report any failure precisely.
