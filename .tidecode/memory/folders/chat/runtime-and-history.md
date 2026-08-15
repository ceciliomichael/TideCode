# TideCode Chat Runtime and Long-Running Work

## User-visible flow

The renderer gathers the active conversation, selected workspace/context root, chat mode, provider, model, reasoning effort, terminal execution mode, compaction settings, and current messages. It invokes `tidecodeChat.startStream`. The main process selects the provider runtime and returns a stream ID immediately while the actual model/tool loop runs asynchronously.

The renderer listens to `chat:stream:event` and updates streaming state, message content, tool invocation traces, waiting indicators, compaction markers, context usage, errors, and terminal completion state. Conversation persistence is performed by the main process and is eventually reflected back into renderer state through the existing history workflows.

## Shared runtime responsibilities

`electron/chat/shared/runtime.ts` is the central orchestration boundary for provider execution. Its stable sequence is:

1. Normalize context-compaction settings and create a run ID.
2. Resolve the conversation ID, if the turn belongs to a saved conversation.
3. Load enabled skills for the agent context root.
4. Create tools with the current checkpoint, conversation ID, turn ID, workspace root, execution mode, and renderer sender.
5. Sort tools, add canonical tool-model output behavior, and apply provider cache breakpoints.
6. Build the chat prompt from mode, messages, workspace root, and execution-mode context.
7. Build a prompt-context manifest and fingerprint from model/provider/system/tools.
8. Synchronize visible messages into canonical history and project canonical replay when a saved conversation exists.
9. Record `run_started` before the provider stream begins.
10. Create the provider stream with tool-loop continuation enabled.
11. Record completed provider steps in order while processing stream parts.
12. Evaluate automatic compaction triggers and, when needed, compact the model message projection before continuing.
13. Record committed compaction packets and emit corresponding renderer events.
14. Record final replay state, freshness revision, and `run_completed` on successful completion.
15. Record `run_aborted` or `run_failed` on terminal failure.
16. Terminate all background terminal sessions owned by the turn.

History writes are queued per turn and failures are logged without replacing the user-visible stream result. This keeps chat usable while making persistence best-effort at individual write points, with explicit terminal records when the runtime itself fails.

## Provider separation

- `electron/chat/codex/runtime.ts` accepts only `providerId === 'codex'`, creates a Codex client, disables replay of unsupported generic assistant reasoning parts, and delegates to shared execution.
- `electron/chat/apiKey/runtime.ts` accepts non-Codex API-key providers, loads provider configuration, creates the corresponding client, and uses provider-specific reasoning replay policy.
- Both runtimes own their active stream registry and expose cancellation.
- `registerChatGitTerminalIpcHandlers.ts` keeps a stream-to-provider map so cancellation and future tool decisions route to the original provider.
- Tool-decision submission is currently an explicit unsupported path in both provider runtimes; it must not be changed to fake success.

## Canonical replay model

Canonical history is not just an audit log. It is used to reconstruct model-facing messages with provider/model context and replay fidelity. The runtime records:

- synchronized visible message IDs and content digests;
- active branches when history is edited or replaced;
- context fingerprints and reasons for context changes;
- initial messages and model/provider identity for each run;
- provider step messages, metadata, finish reasons, and usage;
- compaction packets and projected messages;
- replay projections for provider/model slots;
- freshness revisions and invalidated subjects;
- terminal run state.

When a user edits or replaces history, the event store may create a new branch and preserve replay data for retry scenarios. New chat features must account for edited-history branches and must not assume a single immutable linear transcript.

## Compaction behavior

Compaction exists in two forms:

- **Automatic compaction** during the tool-enabled runtime when token budget calculations cross the configured trigger threshold.
- **Manual compaction** through `chat:compactConversation`, which emits explicit started/committed/failed events and returns whether compaction succeeded, its packet ID, and whether a fallback was used.

The compaction gate verifies that a required compaction actually produced a usable projected budget. A failed or unavailable compaction must remain observable and must not silently discard context.

## Tool and workspace context

Tools are created from the current workspace root and execution mode. Workspace paths, terminal sessions, checkpoint IDs, and conversation IDs are passed into tool construction so file mutations can be attributed to the active turn. The runtime also tracks tool freshness: observation tools record knowledge, while mutation tools and terminal activity invalidate affected subjects.

The prompt includes current execution-mode context. When execution mode changes, the runtime ensures the model-facing message projection reflects the current mode rather than continuing with stale mode instructions.

## Change guidance

When modifying chat behavior:

- Start with a focused test around the smallest pure function or state transition.
- Preserve event ordering and stream terminal semantics.
- Keep provider-specific behavior in the provider runtime or provider policy modules.
- Keep orchestration in shared runtime; do not duplicate it in UI components.
- Persist new replay-critical facts in canonical history before depending on them for future turns.
- Make abort handling idempotent and ensure active sessions/streams are cleaned up.
- Verify both visible conversation persistence and canonical replay behavior.

Verified against the shared runtime, provider runtimes, event store, and IPC routing on August 11, 2026.
