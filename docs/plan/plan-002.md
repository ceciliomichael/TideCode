# Plan 002: Model-Orchestrated Code Mode for Agent Tools

Status: proposed

This plan changes TideCode's model-facing orchestration from one model round-trip per concrete tool call to local Code Mode execution. Existing filesystem, patch, terminal, Git, Kanban, memory, MCP, and other tool implementations remain the authority for real work. Code Mode only coordinates those implementations inside the local TideCode application.

This plan follows [Plan 001](./plan-001.md): compaction remains a runtime context-management concern, while Code Mode reduces unnecessary model/tool boundaries and keeps intermediate results out of the model history.

## 1. Shared understanding

The target is not a second set of tools and not a remote code-execution service.

The target is:

```text
User request
    ↓
Provider adapter / model
    ↓
preloaded local APIs     direct inside Code Mode
    ↓
tool_search(query)       MCP discovery only when needed
    ↓
code_mode(code, allowedTools?)
    ↓
Local Code Mode executor
    ↓
Existing TideCode tool implementations
    ↓
One bounded execution result
    ↓
Provider adapter / model
    ↓
Final answer or another orchestration step
```

In the target agent mode, the model initially sees only these meta-tools:

- `tool_search` — searches the internal registry and returns the APIs needed for the task.
- `code_mode` — executes temporary JavaScript locally with a restricted `tools` object. All non-MCP registry tools are preloaded as compact `tools.<name>({ ... })` contracts; discovered MCP names may be added through `allowedToolNames`.

The model does not directly see every concrete JSON Schema in the normal request. It sees compact callable signatures for non-MCP tools, discovers MCP APIs only when needed, writes one orchestration program, and receives one projected result instead of a separate model turn after every internal read/search/edit.

The outer model loop remains unlimited. The executor has independent per-execution safety limits so generated code cannot consume unbounded CPU, memory, tool output, or tool calls inside one model action. An executor limit is not a model tool-loop limit.

## 2. Architectural invariants

These rules are mandatory for the migration:

1. Existing concrete tool implementations remain the source of truth for side effects, permissions, validation, approvals, checkpoints, and result presentation.
2. Direct/native tool calling and Code Mode use the same internal registry during the migration.
3. The local executor never receives raw filesystem, shell, Git, network, Electron, Node.js, or process capabilities.
4. Generated code can interact with the workspace only through validated registry tools.
5. Provider-specific response formats stop at the provider adapter boundary.
6. Intermediate Code Mode tool results remain inside the executor unless the program explicitly returns a bounded value.
7. Code Mode is local to the existing Electron application. No remote execution service, HTTP worker, or distributed sandbox is introduced.
8. Existing workspace restrictions, command approval, destructive-operation protection, MCP policy, Git safeguards, and user confirmations remain enforced by the existing tool implementations.
9. The default Code Mode model surface contains `tool_search` and `code_mode`; non-MCP callable contracts are documented on `code_mode`, while MCP tools remain dynamic.
10. The migration is reversible through an execution-mode setting and does not invalidate existing conversation history.

## 3. Current TideCode boundary

The current native tool construction is centered in:

- `electron/chat/shared/tools/factory.ts`
- `electron/chat/shared/tools/*.ts`
- `electron/chat/shared/tools/workspaceTools.ts`
- `electron/chat/shared/tools/workspaceMutationTools.ts`
- `electron/chat/shared/tools/workspaceReadTools.ts`
- `electron/chat/shared/runtime.ts`

The current agent tool set includes concrete tools such as `read`, `list`, `glob`, `grep`, `edit`, `write`, terminal tools, Kanban, memory, MCP discovery/execution, and provider-specific tools where supported.

Code Mode uses the existing structured `edit` implementation for targeted source changes and `write` for complete-file replacement or creation. The model-facing mutation name is `edit`; its implementation and result contract remain centralized in the existing edit backend. The Code Mode registry should expose the current concrete names and schemas; it should not invent generic aliases such as `read_file` or `edit_file` unless a compatibility adapter is genuinely required.

Provider-native tools such as Codex's provider web search are not automatically local executable tools. They must either receive a deliberate local registry adapter or remain available only in the legacy direct/provider path until an equivalent local implementation exists.

## 4. Execution modes and rollout

Add an internal execution strategy with three phases:

```ts
type AgentOrchestrationMode =
  | 'direct'
  | 'hybrid'
  | 'code_mode'
```

### `direct`

The current native tool path. It is retained for compatibility, diagnostics, provider comparison, and immediate rollback.

### `hybrid`

The model may receive the meta-tools and selected direct tools during migration experiments. This mode is not the desired default because exposing both surfaces encourages the model to choose the less efficient path unpredictably.

### `code_mode`

The intended target. The model receives `tool_search` and `code_mode`; non-MCP tools are available through preloaded local callable contracts, while connected MCP tools are available only after dynamic discovery.

Agent mode now uses `code_mode` unconditionally. There is no user-facing orchestration selector and no persisted orchestration setting. The `direct` and `hybrid` branches remain internal compatibility paths for tests, diagnostics, provider comparisons, and old-history handling; they are not part of the normal agent UI or runtime selection.

## 5. Unified internal tool registry

Create a registry that describes and executes the existing concrete tools without duplicating their implementations.

Suggested types:

```ts
interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  namespace: string
  exposure: 'code_mode' | 'direct' | 'internal'
  execute(input: unknown): Promise<AgentToolExecutionResult>
}

interface AgentToolRegistry {
  get(name: string): AgentToolDefinition | undefined
  list(): readonly AgentToolDefinition[]
  search(query: ToolSearchQuery): readonly AgentToolDefinition[]
}
```

The registry is created per agent run because tool execution needs the current workspace, checkpoint, conversation, terminal mode, MCP state, and cancellation context.

### Registry construction

The first implementation should adapt the existing AI SDK tool objects rather than rewrite every concrete tool:

1. Existing factories create the concrete tool implementations as they do now.
2. A registry adapter extracts each tool's name, description, input schema, and execute function.
3. Direct mode receives the same native `ToolSet` objects.
4. Code Mode receives registry definitions whose `execute` delegates to those same tool objects.
5. `tool_search` indexes the registry metadata; it never receives or returns executable closures.

The longer-term shape may move registry creation one layer below native-tool conversion, but the first migration must prove shared execution behavior before reorganizing every factory.

### Registry categories

Use conceptual namespaces without renaming existing external tool names:

```text
filesystem: read, list, glob, grep, edit, write
terminal: execute_terminal, read_terminal, interact_terminal, terminate_terminal
workspace: kanban_board, memory
mcp: mcp_tool_search, execute_mcp
runtime: read_tool_output
provider: explicitly adapted provider-local tools only
```

Internal-only tools, compaction helpers, approval callbacks, and renderer operations must not be searchable or callable from generated Code Mode code.

## 6. Model-facing meta-tools

### `tool_search`

The model-facing schema should be compact:

```ts
interface ToolSearchInput {
  query: string
  namespace?: string
  limit?: number
}
```

The result should contain only relevant metadata:

```ts
interface ToolSearchResult {
  tools: Array<{
    name: string
    namespace: string
    description: string
    signature: string
  }>
  allowedToolNames: string[]
}
```

The registry retains each tool's full JSON Schema privately for argument
validation. The model-facing result must not serialize those schemas. It gives
the model a compact callable signature such as
`tools.read({ path: string, offset?: number, limit?: number })`; this is API
documentation, not an executable function. The local executor still validates
the actual object passed to `tools.read` against the private schema before
calling the existing implementation.

Search should match tool name, description, namespace, and capability keywords. It should rank exact names first, then namespace and description matches, and cap the result count. It must not return full tool output, source code, credentials, or executor internals.

The `allowedToolNames` list gives the model the exact dynamically discovered MCP names to pass into `code_mode`. It is optional when the program uses only preloaded non-MCP tools. This prevents a generated program from silently depending on undocumented dynamic tools.

### `code_mode`

The initial schema should be:

```ts
interface CodeModeInput {
  code: string
  allowedToolNames?: string[]
}
```

The model-generated program receives:

```js
const result = await tools.read({ path: 'package.json' });
return { version: JSON.parse(result.body).version };
```

The executor creates `tools` for all preloaded non-MCP names and any exact dynamic names in `allowedToolNames`. Every property access and invocation is checked against the registry. Unknown names, malformed arguments, unavailable tools, and disallowed tools become structured execution errors; they do not reach the filesystem or shell.

The program should return a JSON-compatible value. The executor must reject or safely project functions, class instances, streams, circular values, binary payloads, and oversized objects before returning anything to the model.

The `code_mode` tool result should include bounded metadata such as:

```ts
interface CodeModeResult {
  status: 'success' | 'error' | 'aborted'
  output?: unknown
  toolCalls: Array<{
    name: string
    durationMs: number
    status: 'success' | 'error'
  }>
  truncated: boolean
  executionId: string
}
```

The user-facing display may show a concise execution summary, while the model receives the structured projection needed to continue.

## 7. Local Code Mode executor

Add a local executor under the Electron-side shared chat runtime, keeping orchestration, sandboxing, and tool bridging separate:

```text
electron/chat/shared/codeMode/
  contracts.ts       execution input, result, limits, and diagnostics
  executor.ts        lifecycle, timeout, abort, and result collection
  runtime.ts         restricted JavaScript context and generated tools object
  toolBridge.ts      registry lookup, argument validation, and invocation
  serialization.ts   JSON-safe output projection and byte accounting
  validation.ts      code policy checks and forbidden-global checks
```

The executor runs inside the existing local application. Use a dedicated worker for cancellation and CPU isolation from the Electron main event loop. The worker receives only:

- generated code;
- a list of allowed tool names;
- serialized tool metadata needed for diagnostics;
- a request-scoped bridge for invoking existing tools.

The worker must not receive a workspace path with permission to use directly. Tool calls go back through the registry bridge, which invokes the existing implementation and returns a bounded structured result.

### Restricted runtime

The first implementation should provide ordinary JavaScript language features plus a small safe standard surface only. It must not expose:

```text
require
module
process
Buffer
child_process
fs
net
http/https
fetch
import()
Deno
Bun
Electron APIs
worker creation
WebAssembly
```

Disable string and WebAssembly code generation in the execution context where the chosen runtime supports it. Reject obvious forbidden syntax before execution. Treat this as a policy-controlled orchestration runtime, not as a hostile-code security boundary; the actual security boundary remains the existing tool layer and the worker termination/permission controls.

If security review requires protection against a fully hostile local program, replace the JavaScript context with a separately audited isolated engine before enabling destructive tools. Do not claim that Node's `vm` alone is a complete sandbox.

### Executor limits

Use configurable defaults:

```ts
interface CodeModeLimits {
  timeoutMs: number
  maxCodeBytes: number
  maxToolCalls: number
  maxOutputBytes: number
  maxOutputDepth: number
}
```

Start with conservative development values such as 30 seconds, 100,000 code bytes, 100 tool calls, and 1 MB returned output. Tune these with long-session fixtures. The executor must support cancellation from the existing run abort signal and terminate the worker on timeout or cancellation.

Code Mode does not impose a separate concurrent-tool-call cap. Parallel calls remain governed by the per-program tool-call total, timeout, cancellation, tool permissions, and the underlying tool implementations.

`maxToolCalls` limits one generated program only. It must not change the existing unlimited outer model continuation behavior.

## 8. Tool bridge and result projection

The bridge should call the exact existing tool execute function:

```ts
function createCodeModeTools(
  registry: AgentToolRegistry,
  preloadedToolNames: readonly string[],
  allowedToolNames: readonly string[],
  context: CodeModeInvocationContext,
) {
  return new Proxy(/* restricted object */, {
    get(_target, property) {
      const definition = registry.get(String(property))
      if (!definition || (!preloadedToolNames.includes(definition.name) && !allowedToolNames.includes(definition.name))) {
        throw new Error(`Unknown or undiscovered Code Mode tool: ${String(property)}`)
      }

      return async (input: unknown) => definition.execute(input)
    },
  })
}
```

The actual worker bridge must use a request/response protocol rather than transferring executable closures. Each invocation carries:

- execution ID;
- invocation ID;
- registry tool name;
- validated JSON arguments;
- cancellation/timeout ownership;
- bounded result or structured error.

The bridge must preserve the existing tool result semantics, including status, subject, structured metadata, diff presentations, terminal session IDs, recovery IDs, and checkpoint behavior. Code Mode should not flatten a rich patch result into an unstructured string before the generated program sees it.

Intermediate results should be projected at the bridge boundary. Large read/search/terminal results should use existing bounded output and recovery mechanisms. The generated program can filter or aggregate them locally and return only the relevant paths, facts, changed files, or validation summary.

## 9. Prompt steering

The normal agent prompt should become shorter and more decisive:

```text
You are a coding agent.

Use the preloaded local APIs directly inside code_mode.
Use tool_search only to discover connected MCP APIs needed for the task.
Use code_mode for related multi-step work, loops, filtering, parallel independent reads, edits followed by validation, or any workflow that would otherwise require many model turns.
Pass only dynamically discovered MCP names to code_mode when the program uses them.
Keep intermediate results inside the program and return the smallest useful structured result.
Use the existing tool semantics; do not invent filesystem or shell APIs.
Stop when the requested outcome is implemented and proportionally verified.
```

Do not place every concrete tool schema in the stable system prompt. Tool definitions should be generated from the registry and returned by `tool_search`, reducing static context and avoiding conflicting descriptions.

The prompt should explicitly distinguish:

- one simple read or status request: a short Code Mode program is still acceptable, but direct mode may remain useful during migration;
- multi-file search/read/filter/edit/test work: use Code Mode;
- final answer: return it normally, without wrapping it in Code Mode.

The model should not write arbitrary shell scripts to simulate Code Mode. `code_mode` is the intended orchestration boundary.

## 10. Provider-independent action protocol

Create an internal action representation:

```ts
type AgentAction =
  | { type: 'tool_search'; arguments: ToolSearchInput }
  | { type: 'execute_code'; arguments: CodeModeInput }
  | { type: 'answer'; content: string }
  | { type: 'provider_error'; message: string }
```

Provider adapters translate native responses into this representation. The agent loop, registry, executor, permissions, and history code must not branch on OpenAI, Anthropic, Gemini, Ollama, or other provider names.

### Native-capable providers

For providers that support normal tool calls, expose the two meta-tools through the existing AI SDK/provider adapter. The provider sees two stable schemas; the concrete registry stays local.

### Non-native providers

For providers without reliable native tool calling, support a bounded structured envelope:

```json
{
  "type": "execute_code",
  "arguments": {
    "code": "return await tools.read({path: 'package.json'});"
  }
}
```

Parse only the expected action types, reject malformed or extra action fields, and return the validation error to the model as one bounded result. Do not add provider-specific parsing logic to the executor.

### Capability metadata

Add model capability metadata such as:

```ts
interface ModelCapabilities {
  nativeToolCalling: boolean
  structuredActionOutput: boolean
  codeModePreferred: boolean
}
```

`nativeCodeMode` is not required. Code Mode is a local protocol and works when the model can produce either native calls to the meta-tools or the structured fallback envelope.

## 11. Agent loop integration

The target loop is:

```ts
while (!done) {
  const response = await model.generate(context, metaTools)
  const action = providerAdapter.parse(response)

  switch (action.type) {
    case 'tool_search':
      context.addToolSearchResult(await toolSearch.execute(action.arguments))
      break

    case 'execute_code':
      context.addCodeModeResult(await codeMode.execute(action.arguments))
      break

    case 'answer':
      return action.content
  }
}
```

For the current AI SDK runtime, integrate this as a specialized tool loop first rather than rewriting the entire stream lifecycle. `prepareStep`, tool result persistence, abort handling, terminal cleanup, and compaction should continue to operate at the outer model-step boundary.

The Code Mode execution result is one logical tool result. The model should not receive every internal `read`, `grep`, or `edit` result as separate conversation messages. The raw internal invocation trace can be retained in structured execution metadata for auditing and UI diagnostics, subject to output and secret-redaction limits.

Compaction must treat one Code Mode execution and its result as a complete logical interaction. It must not split the generated code call from its execution result or reinsert all internal tool calls into the normal model history by default.

## 12. Security, approvals, and auditing

Every Code Mode invocation must pass through the same existing tool boundaries as direct mode:

```text
Generated JavaScript
    ↓
Code Mode bridge
    ↓
Registry definition
    ↓
Existing tool execute function
    ↓
Path / command / approval / checkpoint checks
    ↓
Workspace side effect
```

Required guarantees:

- `read`, `glob`, and `grep` retain workspace path restrictions.
- `edit` and `write` retain checkpoint capture and mutation queues.
- terminal tools retain sandbox/full-access mode, approval, cancellation, and session cleanup.
- MCP execution retains server/tool discovery and permission checks.
- Kanban and memory retain their existing persistence and authorization boundaries.
- tool names and arguments are validated before invocation.
- generated code cannot call a registry tool that is neither preloaded nor included in `allowedToolNames`.
- secrets and raw sensitive file contents are not added to Code Mode telemetry.
- execution logs store metadata and bounded summaries, not unrestricted transcripts.

Add a development execution record:

```ts
interface CodeModeExecutionLog {
  executionId: string
  conversationId?: string
  providerId?: string
  modelId?: string
  startedAt: number
  finishedAt?: number
  toolCalls: Array<{
    name: string
    durationMs: number
    status: 'success' | 'error'
  }>
  status: 'success' | 'error' | 'aborted'
  error?: string
}
```

Keep generated code and arguments behind an opt-in developer diagnostic because they may contain user code, paths, or secrets. Redact credentials and avoid logging complete tool results.

## 13. Persistence and replay

Do not store generated Code Mode source as a user message. Store it as assistant execution metadata associated with one logical meta-tool call, with a bounded execution summary and internal invocation trace.

Extend canonical history only as needed:

- `code_mode` tool call arguments may retain the generated code when audit/replay requires it, subject to a size limit;
- the Code Mode result records execution ID, allowed tools, bounded output, status, and internal call summaries;
- internal concrete tool calls are not automatically projected as separate model messages;
- replay can reconstruct the logical `code_mode` call/result pair without rerunning side effects;
- rerunning a historical Code Mode program is never implicit during replay, compaction, or provider switching;
- existing direct tool calls remain replay-compatible during migration.

Compaction should summarize Code Mode executions as completed logical actions with source-linked files, mutations, validation, failures, and next actions. It should retain enough metadata to explain what happened without forcing every intermediate result back into the next model request.

## 14. File-level implementation map

### New modules

- `electron/chat/shared/tools/registry.ts` — normalized registry contracts and registry construction.
- `electron/chat/shared/tools/registrySearch.ts` — deterministic metadata search and bounded result projection.
- `electron/chat/shared/tools/toolSearchTool.ts` — model-facing `tool_search` wrapper.
- `electron/chat/shared/tools/codeModeTool.ts` — model-facing `code_mode` wrapper.
- `electron/chat/shared/codeMode/contracts.ts` — executor input, output, limits, and invocation records.
- `electron/chat/shared/codeMode/executor.ts` — local execution lifecycle, timeout, cancellation, and worker ownership.
- `electron/chat/shared/codeMode/runtime.ts` — restricted JavaScript context and tools bridge.
- `electron/chat/shared/codeMode/toolBridge.ts` — registry lookup, allowed-name enforcement, and invocation protocol.
- `electron/chat/shared/codeMode/serialization.ts` — JSON-safe output projection and byte limits.
- `electron/chat/shared/codeMode/validation.ts` — generated-code policy validation.
- `electron/chat/shared/agentActions.ts` — provider-neutral action contracts and parsing boundary.

### Existing modules to update

- `electron/chat/shared/tools/factory.ts` — build the registry and expose the two Code Mode meta-tools for agent mode, while retaining explicit direct/hybrid compatibility branches internally.
- `electron/chat/shared/tools/index.ts` — export registry and meta-tool builders.
- `electron/chat/shared/runtime.ts` — select orchestration mode, pass the registry to Code Mode, and persist one logical execution result.
- `electron/chat/codex/runtime.ts` — forward orchestration settings without adding Codex-specific executor behavior.
- `electron/chat/apiKey/runtime.ts` — forward orchestration settings for configured API-key providers.
- `electron/chat/shared/prompts/mode/index.ts` — include the concise Code Mode contract only when Code Mode is active.
- `electron/chat/shared/prompts/mode/agent/prompt.md` and `agent/tooling.md` — steer discovery, orchestration, result filtering, and stopping behavior.
- `electron/chat/shared/messages.ts` and `electron/chat/shared/toolReplay.ts` — preserve logical Code Mode calls/results and avoid replaying side effects.
- `electron/chat/history/eventStore.ts` and canonical history contracts — persist bounded Code Mode execution metadata where required.
- `electron/chat/shared/compaction/*` — treat a Code Mode execution as one logical boundary and summarize its projected result.
- internal compatibility/model capability types — retain orchestration mode only where needed by migration and replay code; do not expose it as an app setting.

Do not delete `editTool.ts`, `workspaceEditTool.ts`, or other existing concrete implementations during the first migration. They may remain used by direct mode, tests, legacy history, or internal compatibility paths even when they are no longer model-visible in Code Mode.

## 15. Migration phases

### Phase 1 — Registry adapter with no behavior change

- Define registry contracts.
- Adapt the existing native tool set into registry entries.
- Verify every registry entry delegates to the same execute function and schema as direct mode.
- Add registry metadata and search tests.
- Keep the native implementations unchanged and make the Code Mode bundle the default for agent mode.

### Phase 2 — Local executor proof of concept

- Implement the worker/runtime lifecycle.
- Execute `return await tools.read({ path: 'package.json' })` locally.
- Verify cancellation, timeout, unknown-tool rejection, output bounds, and no raw Node globals.
- Do not expose Code Mode to normal users yet.

### Phase 3 — Meta-tool surface

- Add `tool_search` and `code_mode` as provider-independent AI SDK tools.
- Generate documentation from registry metadata.
- Add the concise Code Mode prompt contract.
- Keep concrete native tools available only in direct/hybrid modes.

### Phase 4 — Agent-loop integration

- Enable Code Mode as the only normal agent-mode surface.
- Treat each Code Mode call/result as one logical model step.
- Ensure compaction and canonical replay do not expand internal calls into the next request.
- Preserve unlimited outer model continuation.

### Phase 5 — End-to-end coding workflows

- Enable multi-file search/read/filter workflows.
- Enable patch/edit/test workflows through existing mutation and terminal tools.
- Compare direct and Code Mode runs for task completion, context growth, latency, and output quality.

### Phase 6 — Code Mode as the sole normal agent surface

- Keep Code Mode selected by runtime policy rather than a user setting.
- Keep direct mode as an internal developer/replay compatibility path.
- Keep hybrid mode only for controlled tests; do not expose either mode in the normal user-facing surface.

### Phase 7 — Tool discovery expansion

- Add namespaces, capability tags, better ranking, and deferred registry loading only after the core executor is stable.
- Add local adapters for provider-only capabilities only when their security and replay behavior are explicit.

## 16. Test plan

### Registry tests

- Every direct-mode executable tool has exactly one registry entry.
- Registry metadata matches the native tool description and schema.
- Registry execution delegates to the existing implementation.
- Internal-only tools are not searchable.
- Provider-only tools are not silently exposed as local Code Mode tools.

### Tool search tests

- Exact name, namespace, description, and capability queries rank correctly.
- Results are bounded and deterministic.
- Search returns compact callable signatures but never full private schemas,
  executable closures, or sensitive context.
- `allowedToolNames` contains only dynamic registry names returned by the search; preloaded local names do not need to be repeated.

### Executor tests

- A generated program can call one existing tool and return its result.
- Multiple reads/searches execute within one model action.
- Intermediate results do not become separate model messages.
- Unknown tools, undeclared tools, malformed arguments, forbidden globals, dynamic imports, and oversized code fail closed.
- Timeout, cancellation, max tool calls, output size, nesting, and parallelism limits work.
- Worker cleanup happens after success, failure, abort, and timeout.
- Existing tool permission and checkpoint behavior remains unchanged.

### Runtime tests

- Code Mode exposes only `tool_search` and `code_mode` in target mode, with non-MCP callable contracts preloaded on `code_mode`.
- Direct mode preserves the existing native tool surface.
- The outer tool loop remains unlimited.
- One Code Mode execution produces one logical tool call/result pair.
- Completed Code Mode traces expand into the existing user-facing tool presentations; running Code Mode stays hidden until its result is available.
- A model can call `tool_search`, then `code_mode`, then answer.
- Non-native structured action parsing produces the same internal action types.
- Provider adapters do not leak provider-specific types into the executor.

### Replay and compaction tests

- Historical Code Mode executions replay without rerunning side effects.
- Compaction keeps the Code Mode call/result pair intact.
- Compaction summarizes internal tool evidence without re-expanding every call.
- Restart and provider/model switching retain the logical execution result.
- Direct-mode histories remain readable.

### End-to-end fixtures

1. Search for `getUser`, read matching files, filter files containing `getUser(`, and return only affected paths.
2. Find a retry limit, edit the implementation and tests through the existing structured `edit` tool, run the focused test command through existing terminal tools, and return changed files plus validation.
3. Perform repeated repository search/read operations whose raw results exceed the normal model context, then verify that only the filtered Code Mode result enters the next model request.
4. Include prompt-injection strings in repository files and tool output; verify they remain data and cannot access unlisted tools or alter executor policy.
5. Abort a running Code Mode program and verify no worker, terminal session, or unbounded tool invocation remains.

## 17. Evaluation metrics

Compare direct mode and Code Mode on the same deterministic tasks:

- successful task completion;
- correct files and symbols identified;
- mutation correctness and test pass rate;
- model round-trips;
- concrete tool calls;
- Code Mode executions and average internal calls per execution;
- model-visible input/output/reasoning tokens;
- context growth and compaction frequency;
- latency and cancellation responsiveness;
- approval and security violations, which must remain zero;
- replay correctness after restart;
- final answer quality.

The goal is fewer model/tool boundaries and less intermediate context, not merely fewer visible tool cards. Code Mode is successful only if task reliability remains at least as good as direct mode while long multi-step tasks consume materially less model context.

## 18. Acceptance criteria

The migration is ready for Code Mode as the default when:

- Code Mode calls the exact existing tool implementations and no duplicate side-effect backend exists.
- The normal Code Mode model surface contains only `tool_search` and `code_mode` plus the normal answer channel.
- The model can call preloaded local tools directly, dynamically discover MCP tools when needed, and complete a multi-step repository task in one orchestration execution.
- Intermediate tool outputs are filtered locally and are not automatically appended as separate model messages.
- Existing permissions, approvals, checkpoints, terminal cleanup, and mutation safety remain enforced.
- Generated code cannot use raw Node, filesystem, shell, network, Electron, or module-loading APIs.
- Timeout, cancellation, output, code-size, and per-execution tool-call limits are enforced.
- The unlimited outer model loop remains unchanged.
- Direct mode remains available for rollback and old-history compatibility.
- Code Mode calls/results replay without rerunning side effects.
- Compaction treats one Code Mode execution as one logical boundary.
- Non-native providers can use the structured action protocol without executor/provider coupling.
- The end-to-end search/filter and edit/test fixtures pass.
- Long-session measurements show fewer model round-trips and lower model-visible context growth without reducing task success.
