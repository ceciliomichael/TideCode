# Plan 001: Provider-Neutral Long-Running Agent Compaction

Status: proposed

This plan replaces the current manual compression flow with a local, provider-neutral compaction workflow for long-running coding agents. It does not call OpenAI's compaction endpoint or depend on any provider-specific compaction API.

## 1. Decision summary

The application should copy the public contract of OpenAI compaction, not attempt to guess its private implementation:

- Keep the durable conversation and canonical event history intact.
- Build a smaller model-facing context projection when the rendered request approaches a model budget.
- Preserve a validated compaction state packet plus a recent raw tail.
- Replace the model-facing window as one canonical unit; do not prune it again after compaction.
- Run the compactor at the AI SDK step boundary so a tool-heavy loop can compact between model steps.
- Keep compaction state out of user-visible chat messages and out of the system prompt's stable prefix.
- Use one provider adapter interface for Codex and API-key providers, with a deterministic local fallback when model summarization fails.
- Keep the current raw transcript available for replay, migration, audit, and future re-compaction.

The new flow should make “compression mode” an implementation detail. The user-facing action can remain “Compact now,” but it should compact the current conversation's model projection instead of creating a new conversation seeded by an XML-wrapped synthetic user message.

## 2. What OpenAI documents, and what it does not

Sources:

- [OpenAI Compaction guide](https://developers.openai.com/api/docs/guides/compaction)
- [OpenAI Counting tokens guide](https://developers.openai.com/api/docs/guides/token-counting)
- [OpenAI Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI ARC-AGI-3 harness findings](https://openai.com/index/how-two-settings-tripled-our-arc-agi-3-scores/)

### Documented behavior to reproduce locally

OpenAI describes compaction as a way to reduce context size while preserving state needed for later turns. Server-side compaction triggers at a rendered-token threshold, emits a compaction item, and continues with a reduced context. The standalone flow accepts a full context window, including messages, tools, and other items, and returns a new canonical context window. The returned window can contain both a compaction item and retained prior items, and callers are instructed to pass the result forward as-is.

The local equivalent should therefore return a complete `ModelMessage[]` projection, not only a text summary. That projection will consist of trusted runtime context supplied by the normal prompt builder, one validated compaction state item, and a recent raw message tail.

The documented server-side compaction item is opaque and carries prior state and reasoning. OpenAI does not document its summarization prompt, ranking algorithm, retention policy, or encryption format. We should not claim to reproduce those internals. We should implement an inspectable, versioned contract with stronger application-specific guarantees for coding tasks.

### Important cache implication

OpenAI prompt caching requires exact prefix matches. Static instructions, tools, and schemas should come before changing user-specific or conversation-specific content. Compaction necessarily changes the dynamic history suffix, so it cannot preserve a cache entry for the removed transcript. It can preserve the reusable system/tool prefix and avoid making the cache situation worse by:

- keeping system instructions and tool schemas byte-stable;
- keeping compaction packets in model messages, not in the system prompt;
- excluding timestamps, random IDs, and packet contents from the context fingerprint used for the stable cache key;
- retaining the existing lineage-based cache scope for repeated steps in the same run;
- measuring cache reads and writes separately after compaction.

This gives up the cache for the evicted history exactly when that history is removed, but keeps later requests smaller and keeps the stable prefix eligible for reuse. No design can guarantee a cache hit when the prompt suffix or available tool set changes.

### Supplemental finding: retaining reasoning matters

OpenAI's ARC-AGI-3 report is important evidence for this design. In its reported harness comparison, GPT-5.6 Sol improved from 13.3% to 38.3% on the public task set and used roughly 6x fewer output tokens when the harness retained reasoning and used compaction instead of rolling truncation. The report attributes the weaker harness's failure to two memory losses: private reasoning was discarded after each action, and older actions were dropped by a rolling character window.

This does not prove that every provider or coding task benefits identically, but it changes our retention policy: reasoning must not be discarded by default. The compactor should preserve provider-supported reasoning items or encrypted/replayable reasoning content when the provider requires it for continuation. When a provider exposes only ordinary reasoning text, retain the recent bounded portion and distill older reasoning into verified decisions, evidence, and next actions. When a provider exposes no replayable reasoning, do not invent or reconstruct hidden reasoning; rely on explicit assistant output, tool evidence, and the state packet.

This creates three provider capabilities:

- `replayable_reasoning`: provider content that can safely be sent back to the same provider/model;
- `summarizable_reasoning`: visible reasoning text that can be reduced into decisions and evidence;
- `unavailable_reasoning`: private reasoning that cannot be safely or correctly replayed.

Reasoning retention is a provider/model capability and replay-slot concern, not a reason to put hidden reasoning into the system prompt or user-visible chat. Add reasoning-retention A/B evaluations to the long-session benchmark before choosing defaults.

## 3. Current implementation and reasons for replacement

The current path is distributed across:

- `electron/chat/shared/compression.ts`
- `electron/chat/shared/prompts/compression/prompt.md`
- `src/pages/chatInterface/useChatCompression.ts`
- `src/lib/chatCompression.ts`
- `electron/history/conversationCompaction.ts`
- `electron/chat/history/eventStore.ts`
- `electron/chat/history/replayProjector.ts`
- `electron/chat/shared/runtime.ts`

Today, compression:

1. Is manually initiated from the UI.
2. Serializes the conversation into a character-bounded transcript.
3. Keeps the tail when the transcript exceeds 120,000 or 60,000 characters.
4. Calls the selected provider for a free-form CAMP summary.
5. May make a second model call to repair the summary format.
6. Falls back to a locally generated CAMP packet if the provider fails.
7. Creates a new conversation and inserts the summary inside an `tidecode:compressed_history` XML block as a synthetic user message.

This has useful safety fallbacks, but it is not equivalent to compaction in a long-running agent loop:

- character count is only a rough proxy for rendered model tokens;
- tail trimming can cut a tool result or remove the exact user intent needed for continuation;
- free-form summaries do not have machine-verifiable coverage or source boundaries;
- the second repair call increases cost and can still return malformed content;
- the synthetic user message mixes trusted runtime state with user-role content;
- compaction happens outside the AI SDK step loop, so a long sequence of tool calls can still overflow before the user presses the button;
- the new conversation fork complicates replay and does not model a canonical replacement window;
- the summary is not persisted as a typed canonical replay artifact.

Existing strengths to preserve:

- `Message` keeps tool call IDs, arguments, results, and native result presentations;
- canonical history already stores replay projections and provider usage;
- `projectCanonicalReplay` already supports exact replay and suffixing new user turns;
- `eventStore` serializes canonical updates per conversation;
- AI SDK 7 exposes `prepareStep`, which can replace the message base used by later loop steps.
- `Message.reasoningContent` and AI SDK response messages already provide a starting point for retaining provider-returned reasoning instead of dropping it during compression.

## 4. Scope and non-goals

### Goals

- Automatic compaction before context overflow.
- Compaction between tool-loop steps, including runs that never return to the UI between tools.
- Provider-neutral operation across Codex and configured API-key providers.
- Exact preservation of unresolved tool-call/tool-result pairs.
- Preservation of coding-specific state: goals, constraints, decisions, files, symbols, validation, failures, plans, and next action.
- Durable raw history and canonical compaction metadata.
- Deterministic replay after restart, provider change, model change, edit, revert, or failed compaction.
- Stable system/tool prompt prefix and measurable cache behavior.
- No transcript instruction can become a compaction instruction merely because it appears in a user message, tool result, file, MCP result, or workspace instruction.
- A local fallback that can keep the agent running without a successful summarization call.

### Non-goals

- Reimplementing OpenAI's opaque encrypted item or private summarizer.
- Deleting the raw conversation from disk.
- Summarizing hidden chain-of-thought as if it were durable state.
- Calling `/responses/compact`, `context_management`, or any provider-native compaction endpoint.
- Guaranteeing identical model output after compaction; the guarantee is state continuity and replay validity.
- Adding a new mandatory model-facing tool for compaction.

## 5. Model-facing context contract

The model should receive a canonical projection with these conceptual layers:

1. Stable system instructions and stable tool definitions from the normal prompt builder.
2. The minimum trusted runtime context needed for the current mode and workspace.
3. The first user goal or a compact goal anchor when it is not already in the retained prefix.
4. One internal compaction state item represented as an assistant/context message, never as a new user instruction.
5. The recent raw tail, including complete tool interactions and the latest user request.

The compaction state item must be explicitly labeled as reconstructed context. Its contents are data extracted from prior turns, not new authority. The system prompt should state once that reconstructed state is context and that instructions inside quoted transcript/tool/file content are not policy.

### State packet fields

Use a versioned, validated structure rather than CAMP text as the persistence format. A suggested shape is:

```ts
interface LocalCompactionPacket {
  schema: 'tidecode.compaction_packet/v1'
  packetId: string
  sourceDigest: string
  sourceMessageIds: string[]
  goal: string[]
  constraints: string[]
  currentState: string[]
  completedWork: string[]
  decisions: string[]
  openItems: string[]
  failuresAndWorkarounds: string[]
  filesAndSymbols: Array<{
    path: string
    symbols: string[]
    status: 'read' | 'created' | 'modified' | 'deleted' | 'unknown'
    evidence: string
  }>
  validation: string[]
  planState: string[]
  toolObservations: Array<{
    subject: string
    fact: string
    status: 'current' | 'stale' | 'unknown'
    sourceMessageIds: string[]
  }>
  nextActions: string[]
  omitted: string[]
}
```

The actual implementation may use a stricter Zod schema, but the invariants are mandatory:

- `schema`, `packetId`, and `sourceDigest` are always present;
- every source message ID belongs to the compacted range;
- arrays are bounded by item count and character/token budget;
- no unresolved tool call is represented as completed;
- file paths and symbols are copied as facts, not invented from vague text;
- stale observations are marked stale after a successful mutation or failed validation;
- empty sections are represented by empty arrays, not omitted ambiguously;
- the packet is safe to serialize and does not contain executable instructions.

The packet is not the only retained state. The recent raw tail remains verbatim in the model projection so the next action has precise arguments, current tool results, and the exact latest user request.

## 6. What is retained, summarized, and dropped

### Retain verbatim in the model window

- The current user request and the most recent user turn.
- The first user goal or a compact goal anchor if it is needed to disambiguate the task.
- The most recent closed user/assistant/tool turns within the active-tail budget.
- Provider-supported replayable reasoning items/content required for the same provider/model to continue coherently.
- Every assistant tool call whose matching tool result is retained.
- Every retained tool result's `toolCallId`, tool name, arguments, status, and native result shape.
- Recent file mutation results and the immediately following validation results.
- Current plan/Kanban state when it affects the next action.
- Trusted current-mode/workspace context required for permissions and tool selection.

### Summarize with the model

- Older closed user/assistant turns.
- Repeated search output after extracting the relevant paths and findings.
- Large tool output after extracting status, subject, exact artifacts, errors, and validation evidence.
- Decisions and their reasons.
- Completed work and unfinished work.
- Failures, retries, and workarounds that affect future behavior.
- References to files, symbols, tests, commands, and external results.

The summarizer may distill reasoning into decisions and evidence, but it must not synthesize missing hidden reasoning or claim that an unverified idea was implemented. For providers that expose replayable reasoning, the projection builder should preserve that provider-native content directly in the provider/model replay slot and avoid routing it through the prose packet. For providers that expose only visible reasoning text, the packet may retain a bounded, source-linked rationale.

### Drop from the model window, but never from durable storage

- Repeated status text and waiting indicators.
- Duplicate tool results already represented in the packet and outside the active tail.
- Stale observations invalidated by later mutations.
- Verbose output whose relevant facts are already captured with a source reference.
- Old reasoning only when the provider has confirmed that it is not replayable and its material decisions have been captured in the packet.
- Old execution-mode or freshness notices that can be rebuilt from trusted runtime state.
- The current XML wrapper and synthetic compression acknowledgement used by the legacy flow.

Raw messages, canonical events, tool results, usage, and compaction metadata remain persisted so a user can inspect history and the system can rebuild or migrate the projection.

## 7. Compaction trigger and boundary policy

### Token budget

Add a model capability registry field for context-window size. Keep it separate from `maxTokens`, which currently represents output limits. When a provider/model does not expose a reliable context window, use a conservative configured default and mark the estimate as approximate.

The budget calculation should include:

- rendered system prompt;
- rendered tool definitions and schemas;
- model-visible messages and message-part overhead;
- image/file allowances;
- a response/reasoning reserve;
- a safety margin for provider-specific serialization.

Keep `approximateTokenCount` as a fallback, but move it behind a budget service. Where a provider offers a local tokenizer, use it. Do not add a remote token-counting request to every turn; that would increase latency and cost. A remote count can be an explicit diagnostic or an opt-in calibration path only.

### Trigger levels

Use hysteresis so the loop does not compact repeatedly:

- `normal`: below the compaction watermark;
- `compact_soon`: above the watermark and a safe closed prefix exists;
- `compacting`: one in-flight compaction for the conversation/run;
- `emergency`: near the hard budget or after a provider context-size failure;
- `blocked`: no safe boundary exists yet, so retain the current window and wait for a completed tool turn.

Start with configurable watermarks such as 70–80% of the effective context budget, reserve enough room for a normal tool call and result, and target the replacement window below 50–60%. Exact defaults should be validated against representative sessions rather than hard-coded to one provider.

### Safe boundary selection

The window builder must select a boundary between complete logical turns. It must never:

- split an assistant tool-call part from its tool result;
- retain a tool result without its matching call;
- retain a call without its result unless the call is deliberately marked unresolved and the next step can still complete it;
- drop the latest user request;
- compact while a tool approval/decision is pending;
- remove a message needed by an active run checkpoint;
- summarize a result after a mutation without preserving the mutation and validation evidence.

The boundary algorithm should prefer the oldest closed prefix that brings the replacement under the target budget while retaining a fixed minimum recent-tail budget. If the oldest prefix is too large for one summarization request, divide it into closed chunks and merge validated partial packets.

## 8. AI summarization workflow

### Normal path

1. `prepareStep` receives the current AI SDK message state and step metadata.
2. The budget service estimates the rendered request with the current tools and stable system prompt.
3. If below the watermark, return no override.
4. The boundary builder selects an evictable closed prefix and a raw tail.
5. The compaction service computes a stable digest from the prior packet, the evicted model-visible content, and the message IDs. Identical requests reuse the in-flight/result cache and do not spend another model call.
6. The provider adapter sends a no-tools compaction request using the existing provider client abstraction. The transcript is delimited as untrusted data. The compaction request must not be allowed to execute filesystem, terminal, MCP, web, or dynamic tools.
7. The model returns the versioned packet in a bounded format. Prefer a provider-native structured response only when that provider adapter has verified support; otherwise use bounded JSON text followed by local validation.
8. The validator checks schema, source range, item limits, required state coverage, and tool-pair invariants. Invalid output gets at most one small repair attempt; if repair fails, use the deterministic fallback without blocking the main agent.
9. The projection builder returns the complete replacement window: trusted base context, packet item, and raw tail.
10. Persist the compaction commit before allowing future turns to rely on it. The AI SDK receives the same replacement projection as the message base for later steps.

### Incremental merge path

After the first compaction, do not summarize the entire raw transcript again. Feed the next compactor:

- the previous validated packet;
- only the newly evicted closed range;
- the retained tail facts needed to resolve conflicts.

The merge prompt must prefer newer validated evidence, mark stale observations, preserve exact file paths/symbols, and retain unresolved work. This bounds cost as the session grows.

### Large-prefix path

When the evicted prefix cannot fit the compactor's own input budget:

1. Pack closed logical turns into deterministic chunks under a fixed input budget.
2. Summarize chunks independently with the same schema and no tools.
3. Merge partial packets into one packet with a bounded merge request.
4. If any chunk fails, keep its deterministic local facts and mark the packet as degraded.

Do not silently send a character slice that may cut a tool call or erase the beginning of a user request.

## 9. Deterministic fallback

The fallback must be a real projection builder, not only a short prose message. It should extract without a model call:

- first and latest user messages;
- latest assistant content;
- completed tool names, arguments, statuses, and structured result metadata;
- exact paths and symbols found in tool results when available;
- mutation subjects and freshness invalidations from canonical history;
- latest plan/Kanban state available in persisted messages;
- the last failed action and a safe next action.

The fallback must preserve any provider-native reasoning item that the provider adapter marks as replayable. It may not manufacture a replacement reasoning item when the provider does not support one.

The fallback packet must include a `degraded` diagnostic in internal metadata, but the model-facing content should remain concise and actionable. It must not pretend that missing facts were summarized successfully.

If compaction fails entirely, continue the current turn when the current window still fits. If it does not fit, use the emergency projection: deterministic packet, smallest safe recent tail, and an explicit user-visible error only if the agent cannot safely continue.

## 10. Persistence and replay design

### Canonical history changes

Extend `electron/chat/history/contracts.ts` with a versioned compaction snapshot and replace the current string-only `compaction_committed.summary` event with a typed payload. Preserve backward parsing for existing canonical documents.

The compaction commit should contain:

- packet schema/version and packet ID;
- source message IDs and source digest;
- boundary message ID and source revision;
- packet payload or a durable reference to it;
- the projected model-message base used after compaction;
- provider/model/context fingerprint metadata needed to rebuild provider-specific projections;
- degradation/fallback status and diagnostics without raw transcript logging.

Add an event-store function such as `recordCompactionCommitted` in `electron/chat/history/eventStore.ts`. It must use the existing per-conversation update queue and atomic write behavior.

The latest compaction snapshot should be associated with the canonical replay slot, not with a new user message. `recordRunCompleted` should continue to save the final replay projection, including any compaction base used during the run.

### Replay rules

Update `electron/chat/history/replayProjector.ts` so it:

- selects the latest valid compaction snapshot for the provider/model slot;
- rebuilds the compacted base from the packet when the context fingerprint changes;
- appends only raw messages after the compaction boundary;
- preserves current freshness notices as trusted runtime context rather than historical user instructions;
- falls back to the raw `Message[]` projection if the packet or projection cannot be decoded.

If a user edits, reverts, or deletes content before the compaction boundary, invalidate that compaction and create the existing canonical branch. If only messages after the boundary change, retain the compaction and rebuild the suffix. If the provider/model/tool schema changes, retain the provider-neutral packet but rebuild the model-message projection for the new replay slot.

### Raw conversation storage

Keep the current `ConversationRecord.messages` as the user-visible raw transcript for now. Do not replace it with the compacted projection. This makes the migration reversible and avoids destroying user history. The model-facing projection is a canonical-history concern.

## 11. AI SDK runtime integration

Update `electron/chat/shared/runtime.ts` and `ProviderStreamFactoryInput` to expose a `prepareStep` callback through the existing Codex and API-key client wrappers.

The callback should:

- inspect `stepNumber`, `messages`, `initialMessages`, `responseMessages`, and current tool-loop state;
- invoke the compaction decision service only after a complete step or when handling an emergency context failure;
- return a `messages` override when compaction succeeds;
- leave `system` and `tools` unchanged unless trusted runtime context itself changed;
- prevent repeated compaction in the same step by tracking the committed source digest;
- preserve the AI SDK's subsequent response-message append behavior without duplicating tool results.

The runtime should persist the compaction commit through the existing queued canonical writes. The commit should be awaited before the next model step if the next step depends on it. If persistence fails, the replacement must not become the only copy; retain the in-memory projection and mark the run degraded so replay can rebuild from raw history.

Move internal execution-mode and freshness notices out of synthetic user-role history where practical. They are trusted runtime context, not user intent, and should be rebuilt from current runtime state during projection. This is important both for prompt-injection resistance and for preventing compaction from treating runtime policy as conversation content.

## 12. Provider adapter design

Create a narrow compaction adapter around the existing provider clients rather than adding a new endpoint or a second provider stack.

Suggested responsibilities:

- `electron/chat/shared/compaction/provider.ts`: provider-neutral request/response interface;
- Codex/API-key runtime adapters: create a no-tools summarization stream using the configured provider and model;
- `electron/chat/shared/compaction/prompt.ts`: stable compaction instructions and untrusted transcript envelope;
- `electron/chat/shared/compaction/validator.ts`: schema parsing and bounded repair;
- `electron/chat/shared/compaction/fallback.ts`: deterministic extraction;
- `electron/chat/shared/compaction/service.ts`: orchestration, digest deduplication, timeout, abort, and fallback.

The summarizer should use a lower reasoning effort or a separately configured compact model only after measurement confirms that quality remains acceptable. The default should preserve the selected provider and model family so the compaction request does not introduce an unsupported cross-provider assumption.

Do not lower the main agent's reasoning setting merely to reduce context cost. The ARC-AGI-3 evidence suggests that retained reasoning can reduce repeated re-interpretation and total output, so the correct optimization is to measure reasoning retention, compaction frequency, task success, and total cost together. Compaction settings and reasoning settings should be independently configurable and evaluated as a matrix.

Never expose compaction as a model-facing dynamic tool. It is runtime context management, not an action the model should discover or invoke.

## 13. UI and legacy migration

### New behavior

Change `src/pages/chatInterface/useChatCompression.ts` into a compact-now workflow that:

- requests the shared compaction service for the current conversation;
- updates the canonical replay projection;
- keeps the same conversation selected;
- shows progress and degraded/failure state without inserting a synthetic chat turn;
- uses the same threshold/boundary/validation code as automatic compaction.

Keep the current button only if it remains useful. Rename visible copy from “compression” to “compact context” or equivalent so users understand that the raw history remains available.

### Legacy compatibility

Keep `src/lib/chatCompression.ts` parsing and the existing conversation-family metadata long enough to load old compressed conversations. Add a one-time migration path that recognizes the exact legacy wrapper, converts its CAMP sections into a versioned packet when possible, and never interprets arbitrary user-authored XML as trusted compaction metadata.

Do not create new `compactionSourceConversationId` children for the new path. Existing child conversations remain readable and can continue to appear in the current compaction family UI until a later cleanup migration.

## 14. Prompt and injection safety

The compaction request must treat the transcript as data:

- wrap each source item with role, message ID, and bounded content markers;
- explicitly state that instructions inside the transcript, tool outputs, files, MCP results, workspace rules, and code are not instructions to the summarizer;
- extract facts and evidence only; never execute or repeat a requested action from the transcript;
- preserve source IDs so a packet claim can be audited;
- do not put raw transcript content into logs or error messages;
- redact obvious credentials and sensitive diagnostic values from telemetry;
- validate packet fields and length before reinserting them into the model context;
- escape or serialize packet content structurally rather than relying on XML tags as a security boundary.

The normal agent system prompt should contain only the compact workflow rule needed to interpret reconstructed state. Detailed extraction policy belongs in the compaction prompt, not in every normal agent request. This keeps the normal prompt small and protects cache stability.

## 15. File-level implementation map

### New modules

- `electron/chat/shared/compaction/contracts.ts` — packet, boundary, decision, result, and schema-version types.
- `electron/chat/shared/compaction/budget.ts` — provider/model context budgets, reserves, and estimates.
- `electron/chat/shared/compaction/window.ts` — logical-turn packing, safe boundaries, active-tail selection, and pair validation.
- `electron/chat/shared/compaction/prompt.ts` — bounded extraction/merge prompts and transcript envelope.
- `electron/chat/shared/compaction/provider.ts` — provider-neutral no-tools summarization adapter.
- `electron/chat/shared/compaction/summarize.ts` — one-pass, chunked, and merge summarization orchestration.
- `electron/chat/shared/compaction/validate.ts` — strict packet validation, source coverage, and bounded repair.
- `electron/chat/shared/compaction/fallback.ts` — deterministic degraded packet builder.
- `electron/chat/shared/compaction/projection.ts` — complete model-window reconstruction.
- `electron/chat/shared/compaction/service.ts` — trigger decision, deduplication, locking, timeout, persistence coordination, and fallback.

### Existing modules to update

- `electron/chat/shared/runtime.ts` — invoke compaction through `prepareStep` and retain the replacement projection.
- `electron/chat/codex/runtime.ts` — forward the new callback/provider adapter inputs.
- `electron/chat/apiKey/runtime.ts` — forward the new callback/provider adapter inputs.
- `electron/chat/history/contracts.ts` — add typed compaction snapshots/events and schema migration support.
- `electron/chat/history/eventStore.ts` — record and retrieve compaction commits safely.
- `electron/chat/history/replayProjector.ts` — project compacted bases plus raw suffixes.
- `electron/chat/history/validation.ts` — validate new canonical fields and migrate old summaries.
- `electron/chat/shared/messages.ts` — separate trusted runtime context from user-role history where required.
- `src/types/chat.ts` — add UI-visible compaction status only if the UI needs it; do not put the full packet in renderer-facing message types.
- `src/lib/contextUsage.ts` and `electron/chat/shared/runtime.ts` — use the shared budget estimator instead of independent character estimates.
- `src/pages/chatInterface/useChatCompression.ts` — route manual compaction to the same service without creating a child conversation.
- `src/lib/chatCompression.ts` — retain legacy parsing, remove it from the new write path.
- `electron/chat/shared/compression.ts` — convert to a compatibility wrapper or delete after all callers use the new service.
- `electron/history/conversationCompaction.ts` and `electron/history/store.ts` — preserve legacy family metadata while preventing new compactions from forking conversations.

## 16. Test plan

### Contract and validator tests

- Valid packet parses and round-trips deterministically.
- Missing schema, source digest, source IDs, or required arrays fails closed.
- Packet length limits are enforced.
- Source IDs outside the selected range are rejected.
- Tool observations can be marked stale and do not become current accidentally.
- Transcript text containing fake XML, tool instructions, or policy-looking text remains data.

### Boundary and projection tests

- No compaction below the watermark.
- Compaction triggers above the watermark with hysteresis.
- The first/latest user intent and recent tail survive.
- Tool-call/tool-result pairs remain valid.
- Pending approval and unresolved tool calls block compaction.
- Large prefixes chunk only at logical boundaries.
- The replacement projection is under the target budget.
- Repeated preparation with the same digest does not call the summarizer twice.

### Runtime tests

- `prepareStep` receives the current AI SDK message state.
- A successful compaction returns a persistent message-base override.
- Later tool results append exactly once after the compacted base.
- Compaction can happen more than once in a 99999-step tool loop without exponential packet growth.
- A provider timeout, malformed output, or persistence failure falls back safely.
- Emergency compaction does not execute tools or emit a fake user-visible tool call.

### Canonical history and migration tests

- Compaction commits survive restart and project correctly.
- Editing before the boundary invalidates the snapshot and branches as existing history does.
- Editing after the boundary preserves the snapshot and rebuilds only the suffix.
- Provider/model changes rebuild a projection from the provider-neutral packet.
- Existing legacy XML/CAMP conversations still load.
- New compaction never creates a child conversation or synthetic user message.
- Raw user-visible messages remain unchanged after compact-now and automatic compaction.

### Cache and cost tests

- System prompt and tool-schema hashes remain unchanged across compaction when runtime policy/tools do not change.
- Stable cache scope remains the same across a compaction lineage.
- Compaction packet timestamps and IDs do not enter system text, tool definitions, or the stable fingerprint.
- Cache reads, writes, uncached tokens, compaction calls, repair calls, and fallback counts are recorded separately.
- A repeated same-digest compaction is served from the local result cache.

### Long-session evaluation

Create deterministic fixtures for:

- a 100+ tool-call coding task;
- the same coding task with replayable reasoning retained, summarized, and discarded;
- repeated search/read output followed by a mutation and validation;
- a plan/Kanban workflow;
- an MCP-heavy task;
- a user edit/revert after multiple compactions;
- provider failure during compaction;
- prompt-injection strings in tool output and repository files.

Compare baseline versus compacted runs on task completion, exact file/symbol retention, tool-call validity, recovery after restart, reasoning-retention policy, total input/output/reasoning tokens, latency, compaction-call count, cache-read ratio, cache-write volume, and final-answer quality. Treat the ARC-AGI-3 results as motivation for the experiment, not as a target score or a guarantee for coding workloads.

## 17. Delivery phases

### Phase 1 — Instrument and define contracts

Add packet contracts, budget policy, boundary helpers, diagnostics, and tests without changing runtime behavior. Capture current context and cache metrics for representative sessions.

### Phase 2 — Build the local compactor

Implement provider-neutral no-tools summarization, chunking, validation, deterministic fallback, digest deduplication, and projection reconstruction. Test it directly against `Message[]` and `ModelMessage[]` fixtures.

### Phase 3 — Persist canonical compaction

Add versioned canonical compaction events and replay projection support. Make old canonical documents and legacy compressed conversations readable before enabling new writes.

### Phase 4 — Integrate the agent loop

Forward `prepareStep` through both provider runtimes. Compact between steps, persist the commit, and verify that tool result order and native result presentation remain unchanged.

### Phase 5 — Replace the manual flow

Route the UI action to compact-now in the current conversation. Enable automatic compaction at the selected watermark. Remove the new XML/synthetic-user write path while retaining legacy parsing.

### Phase 6 — Tune reliability and cost

Use long-session fixtures to tune watermarks, tail size, packet limits, summarizer reasoning effort, chunk sizes, and fallback thresholds. Keep changes only when task success and state continuity improve at acceptable cost.

## 18. Acceptance criteria

The implementation is ready to replace the current compression mode when all of the following are true:

- Long tool-heavy runs compact automatically before provider context failures in representative fixtures.
- The model receives a complete validated replacement window and no unresolved tool pair is lost.
- The raw transcript remains unchanged and replay can rebuild the same compacted projection after restart.
- Compaction failure never destroys the current conversation and has a deterministic local fallback.
- New compaction never inserts a user-role summary message or creates a conversation fork.
- Provider/model changes do not require rerunning historical tool calls.
- System/tool hashes and lineage cache keys remain stable when their inputs are unchanged.
- Injection-like content in transcript/tool/file data cannot change the compaction policy or execute an action.
- Measured task success is not worse than the current flow, while context growth, latency, and total cost improve for long sessions.
- Reasoning retention is selected by provider capability and measured coding-task evidence rather than discarded globally or assumed to be portable across providers.
