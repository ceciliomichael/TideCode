---
status: draft
---

# Shared live AI runs between CLI and desktop

## Context

The current implementation shares conversation files between CLI and desktop, but it does **not** share the live execution lifecycle.

Evidence from the current code:

- `electron/cli/replTurn.ts` starts `startCodexChatStream` / `startApiKeyChatStream` directly inside the CLI process. The active stream therefore dies when the CLI process exits.
- `electron/cli/replTurn.ts` persists the user message before the turn, but assistant/tool/reasoning output is collected in `CliTurnMessageCollector` and persisted only after `turnSettled` via `persistCliAssistantMessages(...)`. This explains why desktop history does not show live CLI progress during the turn.
- `src/hooks/chatMessageSendWorkflow.ts` already has a better stream-progress model for desktop. It uses `createChatStreamProgressPersistenceController(...)` and writes snapshots during generation, with a 600 ms debounce / character threshold, then flushes the final snapshot.
- `electron/preload.ts` exposes only pull-style history methods (`history:list`, `history:get`, etc.). There is no history/run subscription that tells an already-open desktop renderer that another process changed a conversation.
- `src/hooks/useChatSessionState.ts` computes `runningConversationIds` exclusively from the desktop renderer's local `conversationRuntimeStates`. A CLI-started run can never appear as running in the sidebar because that runtime state exists only in CLI memory.
- `src/hooks/chatHistoryViewModels.ts` already supports `ConversationPreview.hasRunningTask`, so the sidebar UI concept exists; its source of truth is the missing piece.
- `electron/history/conversationMutationQueue.ts` serializes history mutations only inside one process. Desktop and CLI are separate processes, so concurrent read-modify-write operations can still race across processes and overwrite newer conversation snapshots.
- `electron/ipc/registerChatGitTerminalIpcHandlers.ts` keeps `activeChatStreamProviders` in Electron-main memory. Desktop runs therefore also belong to the Electron process and disappear when the desktop app exits.
- `electron/main.ts` quits Electron on `window-all-closed` on non-macOS, so Electron main cannot be the durable owner of a run if desktop handoff must survive closing the app.
- `scripts/build-cli.mjs` already builds a standalone Node runtime under `dist-cli-runtime`, including a copied Node executable. That gives us a practical place to package a local background run service without introducing another runtime dependency.

## Product behavior to implement

A conversation/turn must behave as one shared live object regardless of which Tidecode client started it.

Required scenarios:

1. Start a task in CLI.
   - The conversation is created/updated immediately.
   - An already-open desktop sees the conversation appear/update immediately.
   - Desktop sidebar shows the conversation as actively running before the turn completes.
   - Assistant text, reasoning/tool state, and status progressively appear in desktop while CLI is still running.

2. Close CLI while its task is running.
   - Closing/detaching the CLI does not cancel the task.
   - The run continues in a Tidecode-owned background process.
   - Desktop can attach to the same run and continue observing it.
   - Explicit cancel remains available and must be distinct from merely disconnecting a client.

3. Start a task in desktop, then close desktop.
   - The task keeps running.
   - CLI can resume/attach to the same conversation and receive current state plus future live events.

4. Open both clients simultaneously.
   - Both see the same running state and conversation progress.
   - Tool-approval / steering commands are routed to the single underlying run.
   - There is only one canonical history mutation order per conversation.

5. Reconnect after being detached.
   - Client first receives an authoritative runtime snapshot and latest persisted conversation snapshot.
   - It then subscribes to newer live events without duplicating already-applied output.

The target is client handoff, not transparent recovery after the background service itself crashes. A service crash should retain the last persisted partial transcript and mark the run interrupted; it does not need to resurrect an already-lost provider HTTP stream.

## Recommended architecture

### 1. Add one local Tidecode Run Service

Introduce a standalone Node process that is independent of both Electron renderer/main and the interactive CLI process.

Suggested new modules:

- `electron/runService/index.ts` — standalone entry point.
- `electron/runService/server.ts` — local IPC server and request dispatch.
- `electron/runService/client.ts` — reusable client used by CLI and Electron main.
- `electron/runService/ensureService.ts` — connect-or-launch logic.
- `electron/runService/protocol.ts` — versioned command/event TypeScript types and runtime validation.
- `electron/runService/paths.ts` — local socket/pipe, pid, token, and metadata paths under `~/.tidecode`.
- `electron/runService/runRegistry.ts` — active run state indexed by `runId` and `conversationId`.
- `electron/runService/runExecutor.ts` — owns provider stream execution, assistant draft accumulation, persistence, cancel, steering, and tool decisions.
- `electron/runService/subscriptions.ts` — client subscriptions and monotonically sequenced live events.

Use local-only IPC:

- Windows: Node named pipe, e.g. `\\.\pipe\tidecode-run-service-<stable-user-key>`.
- macOS/Linux: Unix domain socket under a Tidecode-owned directory.

Do not expose an HTTP server on `0.0.0.0` for this desktop/CLI synchronization path. `electron/cli/remoteDaemon.ts` is useful prior art for long-running execution but is not appropriate as the trusted local synchronization transport in its current CORS/token form.

The service should be single-instance per Tidecode user profile. Both desktop and CLI run `ensureRunService()`:

1. Try handshake on the local endpoint.
2. Verify protocol version and an installation/user-scoped secret.
3. If unavailable, acquire a startup lock and spawn the packaged service detached.
4. Retry handshake.
5. Other clients that lose the startup race simply connect to the service that won.

The service stays alive while at least one run is active. When no runs and no clients remain, it may use a short idle shutdown policy. The key rule is that client disconnect must never imply run cancellation.

### 2. Make the service the authoritative owner of active runs

Create a `RunSnapshot` protocol model similar to:

```ts
interface RunSnapshot {
  runId: string
  conversationId: string
  streamId: string | null
  status: 'starting' | 'running' | 'waiting_for_input' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  providerId: string
  modelId: string
  workspaceRootPath: string
  startedAt: number
  updatedAt: number
  lastEventSeq: number
}
```

Do not store `hasRunningTask` directly in conversation JSON. It is runtime state and should come from `RunSnapshot` / run subscriptions.

Commands should cover at minimum:

- `service:hello`
- `runs:listActive`
- `runs:get`
- `runs:startTurn`
- `runs:subscribe`
- `runs:cancel`
- `runs:updatePendingSteerMessages`
- `runs:submitToolDecision`
- `history:get`
- `history:list`

Events should cover:

- `run:created`
- `run:stateChanged`
- `run:chatEvent` containing existing `ChatStreamEvent`
- `conversation:snapshotUpdated`
- `run:completed`
- `run:failed`
- `run:removed`

Wrap service events in an envelope with `seq`, `runId`, and `conversationId`. Maintain a bounded in-memory replay buffer per active run. On attach/reconnect, the client provides its last sequence; if that sequence is too old, the service responds with a full `RunSnapshot` + conversation snapshot before continuing with live events.

### 3. Centralize active-turn conversation mutations

The service should own the read-modify-write sequence for a turn from the moment the user message is accepted until the turn settles.

This is important because the existing `conversationMutationQueue` is only process-local.

For `runs:startTurn`:

1. Serialize on `conversationId` inside the run service.
2. Reject or explicitly queue a second normal turn for the same conversation while one is active; do not allow two independent provider streams to mutate one transcript concurrently.
3. Load/create the latest conversation from `electron/history/store.ts`.
4. Create the workspace checkpoint.
5. Persist the raw user message immediately.
6. Support an optional transient runtime-content override for CLI `@` mention expansion so persisted history stays human-readable while the provider receives expanded context.
7. Register `RunSnapshot(status='starting')`.
8. Broadcast the conversation update + running status before provider startup completes.
9. Start the provider stream in the service.

During the stream:

- Reuse the desktop stream-progress persistence behavior rather than the current CLI end-only append behavior.
- Generalize/move `createChatStreamProgressPersistenceController` out of renderer-specific `src/hooks` naming if necessary so it can be used directly by the service.
- Reuse the message-building behavior currently contained in `createChatAssistantDraftManager` / `CliTurnMessageCollector`, but expose `onConversationMessagesUpdated` so the service gets a complete current transcript snapshot after meaningful deltas.
- Persist snapshots with the same debounce/character-threshold approach used by desktop today.
- Broadcast `conversation:snapshotUpdated` after successful writes and low-latency `run:chatEvent` events immediately.

At completion:

- Queue an immediate final snapshot.
- Flush persistence.
- Mark run `completed` / `failed` / `cancelled`.
- Keep the final run snapshot briefly for reconnect/result acknowledgement, then remove it from active state.

### 4. Move provider control paths behind the run service

Today provider streams and controls are split across:

- `electron/ipc/registerChatGitTerminalIpcHandlers.ts`
- `electron/cli/replTurn.ts`
- `electron/cli/headless.ts`
- `electron/cli/remoteDaemon.ts`

The shared service should become the single owner for normal desktop/CLI turns.

The service may continue reusing:

- `electron/chat/codex/runtime.ts`
- `electron/chat/apiKey/runtime.ts`
- the existing stream-event processing types in `electron/chat/shared/runtimeStreamEvents.ts`
- existing provider-specific cancel, pending-steer, and tool-decision functions.

Provider implementation details should remain behind `runExecutor`; clients address `runId`, not provider internals.

For tool decisions, first accepted valid response wins. When one client submits a decision, broadcast the resulting state so a second attached client dismisses its approval UI. The service must reject stale decisions after the invocation has already resolved.

### 5. Desktop integration

Add a preload-facing runtime API instead of making the renderer aware of sockets/pipes directly.

Suggested changes:

- `electron/preload.ts`
  - add `window.tidecodeRuns` methods for listing active runs, starting/cancelling/steering/approving, and subscribing/unsubscribing to run/conversation events.
- `src/types/chat/apis.ts`
  - define the typed preload API and subscription cleanup signatures.
- `electron/ipc/registerChatGitTerminalIpcHandlers.ts`
  - change normal `chat:stream:start/cancel/updatePendingSteerMessages/submitToolDecision` handlers to delegate to the run-service client during migration, or introduce new IPC names and migrate the renderer before deleting the old direct path.
- `src/hooks/useChatSessionState.ts`
  - merge authoritative service `RunSnapshot`s into runtime state.
  - compute `runningConversationIds` from service state rather than only renderer-local `isSending/activeStreamId`.
- `src/hooks/chatHistoryViewModels.ts`
  - preserve the existing `hasRunningTask` mapping; only change the set it receives.
- `src/hooks/useChatMessages.ts` / `src/hooks/useChatStreamingState.ts`
  - subscribe once at app/session initialization.
  - apply `conversation:snapshotUpdated` to both sidebar summaries and active conversation state.
  - route `run:chatEvent` into the existing display pipeline for smooth sub-persistence-interval rendering.
- `src/hooks/chatMessageSendWorkflow.ts`
  - migrate provider execution ownership to `runs:startTurn`.
  - keep renderer-only composer/edit/revert UX, but avoid creating a second local assistant draft that competes with the service snapshot.

When desktop starts:

1. Connect to the run service.
2. Load normal history.
3. Call `runs:listActive`.
4. Seed runtime states for all active conversations.
5. Subscribe to run/conversation events.
6. If the currently selected conversation has an active run, load latest conversation snapshot and attach to that run.

This guarantees that a CLI-started task immediately appears with the sidebar's existing running indicator.

### 6. CLI integration

Refactor `electron/cli/replTurn.ts` so it no longer owns provider execution.

Target flow:

1. Expand mentions as today.
2. Send `runs:startTurn` with raw input, attachments, runtime expanded text, model/provider/reasoning/chat mode, workspace, and conversation id.
3. Subscribe to that run.
4. Feed received `run:chatEvent` into the existing terminal presentation path.
5. Update local `CliSessionState.messages` from authoritative conversation snapshots rather than appending a second final copy.
6. On completed/failed/cancelled state, detach subscription and continue REPL.

Refactor/remove the end-only behavior in:

- `electron/cli/cliHistory.ts::persistCliAssistantMessages`
- `electron/cli/cliTurnMessageCollector.ts`

The CLI may still use a collector for terminal presentation if useful, but it must not be the canonical persistence owner.

CLI process lifecycle semantics:

- Terminal/window close, EOF, or process exit: unsubscribe/detach only.
- Explicit stop command or the existing intentional cancel gesture: send `runs:cancel`.
- Do not send cancel from a generic process-exit/finally handler.

For `/resume`, after loading the conversation also query the run service. If a run is active, attach to it and render its current status instead of treating the conversation as idle.

Apply the same service client to `electron/cli/headless.ts` so headless tasks also get durable client handoff semantics.

`electron/cli/remoteDaemon.ts` can remain a separate remote-control feature initially. Later it should preferably forward prompts into the same run service instead of starting a fourth independent provider-owner path.

### 7. History synchronization and write safety

Long-term, the cleanest invariant is: **the run service is the single writer for conversation records while it is running**.

Phase 1 can centralize active-turn writes immediately. For other mutations (rename, archive, pin, revert, delete), choose one of these during implementation:

Preferred:

- Route desktop `history:*` and CLI history mutation calls through the service as well, making the service the process-wide history mutation authority.

Temporary compatibility alternative:

- Add a real cross-process file lock around conversation read-modify-write operations.

Do not rely on `conversationMutationQueue.ts` alone for cross-client safety.

If the preferred route is adopted, keep `electron/history/store.ts` as the storage implementation and call it inside the run service. Electron main/preload APIs become forwarding layers rather than parallel writers.

### 8. Packaging / startup

Update `scripts/build-cli.mjs` to build a second Node entry point for the service, for example:

- `dist-cli-runtime/run-service.mjs`
- optionally `dist-electron/run-service/index.js` for development convenience.

Reuse the standalone Node executable already copied into `dist-cli-runtime`.

Packaged desktop startup should spawn the Node runtime under `process.resourcesPath/cli/` rather than an Electron utility process, because the service must survive Electron quitting.

Add a development launch path that resolves the source/build output predictably without requiring a packaged app.

Update `electron-builder.json5` only if the existing `dist-cli-runtime -> resources/cli` mapping does not already include the new service bundle automatically.

### 9. Local security and robustness

- Bind only to local named pipe / Unix socket.
- Use an installation/user-scoped random authentication token stored under `~/.tidecode` with restrictive permissions where supported.
- Validate protocol payloads at the service boundary; do not trust renderer/CLI JSON blindly.
- Include `protocolVersion` in handshake and fail with an actionable version-mismatch response.
- Limit reconnect event buffers and payload sizes.
- Never accept a workspace path or tool-decision request for a run that the service did not create.
- Detect stale pid/socket metadata and clean it only after confirming the old endpoint is dead.
- Log service lifecycle and run ids to a bounded Tidecode log file for diagnosing handoff failures.

## Implementation phases

### Phase 1 — Shared service skeleton and protocol

Files:

- add `electron/runService/{index,server,client,ensureService,protocol,paths,runRegistry}.ts`
- update `scripts/build-cli.mjs`
- add focused service handshake/singleton tests under `tests/runService/`

Deliverable:

- Desktop and CLI can connect to the same local service.
- Service survives either client process exiting.
- `runs:listActive` and subscription transport work with synthetic test runs.

### Phase 2 — Service-owned stream execution + real-time persistence

Files:

- add `electron/runService/runExecutor.ts`
- refactor reusable persistence/draft code from `src/hooks/chatStreamProgressPersistence.ts`, `src/hooks/chatAssistantDrafts.ts`, and/or `electron/cli/cliTurnMessageCollector.ts`
- reuse `electron/chat/{codex,apiKey}/runtime.ts`
- use `electron/history/store.ts` inside service

Deliverable:

- A service-started turn persists partial assistant progress during streaming.
- Client disconnect does not terminate the provider stream.
- Final state is flushed exactly once.

### Phase 3 — CLI migration

Files:

- `electron/cli/replTurn.ts`
- `electron/cli/headless.ts`
- `electron/cli/cliHistory.ts`
- `electron/cli/cliTurnMessageCollector.ts`
- `electron/cli/replCommands.ts` / resume flow as needed

Deliverable:

- CLI is a presentation/input client of the service.
- Close CLI mid-turn; run continues.
- Reopen CLI `/resume`; active run is detected and attached.

### Phase 4 — Desktop live subscription + sidebar status

Files:

- `electron/preload.ts`
- `src/types/chat/apis.ts`
- `electron/ipc/registerChatGitTerminalIpcHandlers.ts`
- `src/hooks/useChatSessionState.ts`
- `src/hooks/useChatMessages.ts`
- `src/hooks/useChatStreamingState.ts`
- `src/hooks/chatMessageSendWorkflow.ts`
- potentially a new `src/hooks/useRunServiceSubscription.ts`

Deliverable:

- CLI-started conversation appears/updates in already-open desktop without manual reload.
- Sidebar immediately shows `hasRunningTask`.
- Opening the conversation shows current partial transcript and future deltas.
- Desktop-started tasks likewise survive desktop exit.

### Phase 5 — Unify remaining history mutations and remote entry points

Files:

- `electron/ipc/registerCoreIpcHandlers.ts`
- `electron/history/store.ts`
- CLI history commands
- `electron/cli/remoteDaemon.ts`

Deliverable:

- No cross-process conversation read-modify-write races remain.
- Remote daemon forwards through the same run authority instead of owning provider streams itself.

## Testing plan

Add deterministic tests; do not rely only on manual Electron testing.

### Unit tests

1. `runRegistry`
   - one active normal run per conversation.
   - state transitions are valid and terminal states cannot return to running.
   - event sequence monotonically increases.

2. stream persistence
   - content deltas generate debounced conversation snapshots.
   - character threshold triggers immediate flush.
   - final completion flushes latest state.
   - failure/cancel persists the expected partial/final transcript.

3. protocol
   - version mismatch rejected.
   - malformed commands rejected.
   - stale tool decision rejected.

4. service client
   - disconnect does not send cancel.
   - reconnect receives snapshot + events after last known sequence.

### Integration tests

Use child Node processes to model separate CLI and desktop clients.

1. Start service from client A; client B connects to same service.
2. Start fake streamed run from A; B receives `run:created` immediately.
3. Kill A mid-stream; service keeps emitting and persists final transcript.
4. Attach B after A is killed; B receives current snapshot and remaining deltas.
5. Start from B, disconnect B, attach A; same behavior in reverse.
6. Simultaneous history operations for one conversation preserve both mutations or are serialized/rejected deterministically.
7. Two attempts to start a normal turn in one conversation do not create two uncontrolled provider streams.

### Desktop/CLI acceptance test

Manual smoke flow on Windows, since the reported issue is Windows:

1. Launch desktop and CLI for the same project.
2. Start a long task in CLI.
3. Within about one persistence/event interval, verify desktop sidebar shows the same conversation as running.
4. Open it and verify assistant/tool progress changes before the CLI turn finishes.
5. Close the CLI terminal window without issuing explicit cancel.
6. Verify desktop continues receiving output until completion.
7. Start another long task from desktop.
8. Exit desktop normally.
9. Open CLI and `/resume` that conversation.
10. Verify CLI shows it is still running and receives continued output.

## Migration / compatibility notes

- Existing conversation JSON must remain readable; do not require destructive migration just to add runtime sync.
- Runtime status should not be embedded as durable `isRunning` in `ConversationRecord`, because an app/service crash would leave false running flags behind.
- Preserve current message ids and assistant/tool message shape so existing history, replay, compaction, checkpoints, and citations keep working.
- Keep the old direct Electron/CLI provider-start path behind a temporary feature flag during migration if needed, but do not allow both paths to own the same run simultaneously.
- Clean up the old path after Phase 4 proves parity; otherwise future changes will drift across two execution architectures.

## Risks and mitigations

### Risk: duplicated UI messages from persisted snapshots plus live events

Mitigation: message-id based reconciliation. Live events update ephemeral/current draft state; authoritative conversation snapshots replace/reconcile by message id rather than append blindly.

### Risk: service and client versions differ after app update

Mitigation: versioned handshake. If there are no active runs, client can ask an old idle service to exit and start the bundled matching version. Never kill a mismatched service that still owns an active run; show a compatibility state and allow that run to finish first.

### Risk: app update removes binaries while a detached service is active

Mitigation: service runs from its already-loaded executable/bundle and must not depend on files being replaced mid-run. Update/install flow should query active runs and avoid forcibly terminating the service unless user explicitly chooses to stop work.

### Risk: tool approval with no attached client

Mitigation: service transitions run to `waiting_for_input` and persists the decision-request state. It waits until a client attaches and responds; disconnect is not interpreted as denial.

### Risk: desktop/CLI both send a follow-up at the same time

Mitigation: service serializes per conversation. Either accept one and return a clear `conversation_busy` response for the other, or enqueue explicit steer/follow-up behavior using the existing pending steer mechanism; never start two unsynchronized streams.

## Acceptance criteria

The feature is complete when all of the following are true:

- Starting a task from CLI marks the matching desktop sidebar conversation as running without waiting for turn completion or manual refresh.
- Desktop receives visible partial assistant/tool progress while the CLI turn is still streaming.
- Closing CLI without explicit cancellation does not stop the task.
- Desktop can attach to and continue observing that CLI-started task.
- The reverse desktop-to-CLI handoff works the same way.
- Both clients show one canonical transcript with no duplicate assistant/tool messages after reconnect.
- Explicit cancel from either attached client cancels the one shared run and both clients observe the cancelled state.
- Tool-decision and steering commands work from whichever client is attached.
- Conversation writes cannot be lost because desktop and CLI performed overlapping read-modify-write operations in separate processes.
- Existing saved conversations remain compatible.
- Service crash leaves the latest persisted partial transcript recoverable and marks the stale run as interrupted rather than falsely running forever.

## Recommended implementation principle

Treat **conversation history as durable shared state** and **active runs as ephemeral shared state owned by one local service**. Desktop and CLI should not know or care which client originally started the run. They should both perform the same operations: submit, subscribe, detach, reattach, steer/approve, and explicitly cancel.
