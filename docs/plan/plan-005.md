# Plan 005: Run-Service Terminal Broker

Status: implemented

This plan replaces TideCode's split terminal ownership with a single durable terminal broker hosted by the run service. The broker becomes the sole authority for PTY creation, command state, attachment, output retention, cancellation policy, and process cleanup across the desktop terminal, AI terminal tools, CLI clients, and future remote clients.

The immediate drivers are two independently confirmed failures:

1. A cancelled chat stream can be rendered as `Tool execution terminated` even when the terminal tool never started.
2. AI-created PowerShell processes can survive turn cleanup after TideCode removes their in-memory session records.

The target design makes chat streaming and terminal execution separate but coordinated lifecycles. A chat may stop without destroying the evidence needed to understand the terminal outcome, and a terminal process may only be forgotten after its termination has been verified or transferred to an orphan-reaper state.

---

## 1. Decision Summary

- **One PTY owner:** Only the run-service process creates and owns PTYs.
- **Durable identities:** Every terminal session and command operation receives a stable UUID independent of renderer-local tab IDs and AI-visible numeric aliases.
- **Attachable clients:** Desktop, CLI, AI, and remote surfaces attach to broker sessions and may reconnect without changing the underlying session identity.
- **Separate lifecycles:** Chat runs, tool calls, terminal sessions, and terminal command operations have explicit independent states.
- **Typed cancellation:** Cancellation requests include reason, source surface, actor, and terminal policy.
- **Verified cleanup:** A terminal record is not silently discarded when Windows process-tree termination fails. Failed cleanup enters a recoverable orphan state and is retried.
- **Retained evidence:** Completed and terminated operations retain a bounded transcript and final state long enough for history, diagnostics, and reconnecting clients.
- **Compatibility bridge:** Existing renderer terminal APIs and AI numeric `session_id` values remain supported while internally mapping to broker UUIDs.
- **System shell parity:** Visible and AI terminals resolve the same system shell. Windows prefers PowerShell 7 and falls back through Windows PowerShell to Command Prompt only when necessary.

---

## 2. Current-State Problems

### 2.1 Split ownership

The Electron main process owns visible-terminal sessions, while the run service owns terminal sessions used by AI tools. Both load the same terminal modules, but each process has a separate module-level session registry. This creates two authorities with different client lifecycles and no common durable session identity.

### 2.2 Turn-scoped AI state

AI terminal bookkeeping is stored in a turn-local map. The runtime's `finally` block terminates all sessions for the turn and deletes the map, even when cleanup cannot prove the operating-system process exited.

### 2.3 Cancellation conflation

The stream runtime creates tool-invocation state while tool arguments are still arriving. If the stream is cancelled before the complete tool call exists, the runtime synthesizes the same failure used for an executing tool. A partially streamed request is therefore presented as a terminal execution failure.

### 2.4 Unverified Windows termination

Windows cleanup invokes `taskkill`, ignores a nonzero result, unregisters the session before confirming process death, and only calls the PTY fallback if process spawning throws. A surviving process becomes unreachable from TideCode's registry.

### 2.5 Missing provenance

Canonical history records `Chat stream aborted.` but does not persist whether cancellation came from Stop, revert, edit, deletion, CLI input, shutdown, replacement, timeout, or another attached surface.

---

## 3. Target Architecture

```text
 Desktop renderer          CLI/TUI             AI tool runtime          Remote client
        |                     |                       |                       |
        +---------------------+-----------------------+-----------------------+
                                      |
                         Run-Service Client Protocol
                                      |
                     +----------------+----------------+
                     |                                 |
             Chat Run Registry                 Terminal Broker
                     |                                 |
              cancellation intent          sessions / operations / leases
                     |                                 |
                     +---------- policy --------------+
                                                       |
                                                  PTY Adapter
                                                       |
                                         PowerShell / shell / cmd / zsh
```

The terminal broker is not nested inside a renderer or a Code Mode worker. Code Mode calls a broker-backed adapter. The desktop terminal uses the same broker through the existing preload API. The chat runtime references broker operation IDs but does not own the PTY lifecycle.

---

## 4. Domain Contracts

### 4.1 Terminal session

A session represents one interactive shell PTY.

Required fields:

- `sessionId`: durable UUID.
- `legacySessionId`: optional numeric compatibility alias scoped to a client/run.
- `workspaceRootPath` and current `cwd`.
- `ownerKind`: `visible`, `ai`, `cli`, or `remote`.
- `createdBy`: client/surface identity.
- `shell`: command, kind, label, version when discoverable, arguments, and resolution source.
- `state`: `creating`, `ready`, `busy`, `needs_interaction`, `exited`, `terminating`, `terminated`, `termination_failed`, or `orphaned`.
- `processId`, creation time, last-activity time, exit code, signal, and terminal dimensions.
- Bounded output cursor and transcript metadata.
- Attached client IDs and lease information.
- Optional conversation, run, and tool-call associations.

### 4.2 Terminal operation

An operation represents one marked command executed inside a session.

Required fields:

- `operationId`: durable UUID.
- `sessionId`.
- `command`, `cwd`, creation/start/completion timestamps.
- `state`: `queued`, `writing`, `running`, `needs_interaction`, `completed`, `command_failed`, `cancel_requested`, `terminating`, `terminated`, `termination_failed`, or `session_lost`.
- Completion-marker identity and output range.
- Exit code and termination result.
- Chat/run/tool-call associations.
- Cancellation provenance when applicable.

### 4.3 Cancellation provenance

Cancellation requests carry:

- `reason`: `user_stop`, `message_revert`, `message_edit`, `conversation_delete`, `run_replaced`, `surface_shutdown`, `provider_timeout`, `provider_failure`, `service_shutdown`, or `unknown`.
- `surface`: `desktop`, `cli`, `mobile`, `remote`, or `system`.
- `requestedAt`.
- Optional conversation and run IDs.
- Terminal policy: `detach`, `terminate`, or `terminate_after_grace`.

### 4.4 Tool interruption taxonomy

- Arguments incomplete: `tool_request_cancelled`.
- Complete call accepted but executor not entered: `tool_start_cancelled`.
- Executor running when cancelled: `tool_execution_cancelled`.
- Shell or PTY creation failure: `terminal_infrastructure_failed`.
- Command returned nonzero: `command_failed`.
- Process explicitly terminated: `command_terminated`.
- Session disappeared unexpectedly: `terminal_session_lost`.

---

## 5. Broker Responsibilities

The broker owns:

1. Session creation, indexing, attachment, detachment, resizing, writes, and closure.
2. Operation creation and completion-marker observation.
3. Output buffering with monotonic cursors and bounded retention.
4. Event fan-out to all attached clients.
5. Snapshot/query APIs independent of chat streams.
6. Lease expiry for disconnected clients.
7. Explicit cancellation policy application.
8. Verified process-tree termination and bounded retries.
9. Orphan detection and reaping.
10. Sanitized diagnostics and retained final records.

The broker must not own chat history projection, model-provider behavior, React state, or Code Mode parsing.

---

## 6. Run-Service Protocol

Add authenticated request methods for:

- `terminalCreateSession`
- `terminalAttachSession`
- `terminalDetachSession`
- `terminalListSessions`
- `terminalGetSession`
- `terminalCreateOperation`
- `terminalReadOperation`
- `terminalWrite`
- `terminalResize`
- `terminalCancelOperation`
- `terminalTerminateSession`
- `terminalCloseRecord`

Add broker events for:

- `terminal_session_changed`
- `terminal_output`
- `terminal_operation_changed`
- `terminal_session_terminated`
- `terminal_cleanup_failed`

Every request remains token-authenticated by the existing run-service transport. Ownership and workspace scope are validated server-side; renderer input is not trusted.

---

## 7. Client and Compatibility Strategy

### 7.1 Desktop terminal

The Electron IPC handlers retain the existing `window.tidecodeTerminal` API. Internally they proxy requests to the run-service client. Renderer tab state stores the durable broker session ID while continuing to accept the current numeric ID during migration.

Terminal output events received from the run service are forwarded to the renderer's existing terminal event channel. Renderer reconnection reattaches by durable session ID and requests output from its last acknowledged cursor.

### 7.2 AI tools

`execute_terminal` creates an operation through the broker and returns the existing numeric `session_id` plus durable `terminal_session_id` and `operation_id` metadata. `read_terminal`, `interact_terminal`, and `terminate_terminal` resolve the numeric alias through a run-scoped adapter and operate on the broker record.

The adapter may be disposed at the end of a model turn without deleting the broker record. Cancellation policy, not adapter disposal, decides whether a process continues or terminates.

### 7.3 CLI and future remote surfaces

CLI clients attach using the same protocol and cursor model. Socket disconnection detaches the client; it does not implicitly cancel the run or destroy a terminal session.

---

## 8. Cancellation Policy

Default behavior:

| Trigger | Chat behavior | Terminal behavior |
| :--- | :--- | :--- |
| Explicit Stop | Abort model stream immediately | Terminate AI-owned active operation, capture final output, verify process exit |
| Revert/edit/delete | Abort with typed reason | Same as explicit Stop unless caller requests detach |
| Renderer disconnect | Keep shared run active | Detach only; retain session lease |
| CLI disconnect | Keep shared run active | Detach only; retain session lease |
| Provider failure | Mark run failed | Terminate after a short grace period and preserve transcript |
| Normal turn completion | Complete run | Close idle AI shell after final operation is recorded |
| Visible terminal tab close | No chat effect | Terminate that visible session after verification |
| Run-service shutdown | Persist final snapshots | Terminate all PTYs and record cleanup results |

No terminal command continues indefinitely without a live lease or explicit persistent-session policy.

---

## 9. Process Termination and Orphan Reaping

### 9.1 Windows

1. Mark the session `terminating` without removing it from the registry.
2. Invoke the absolute System32 `taskkill.exe` path with `/PID`, `/T`, and `/F`.
3. Inspect spawn error, status, and signal.
4. If unsuccessful, call the node-pty kill primitive.
5. Wait for exit notification or verify the PID no longer exists within a bounded interval.
6. Retry once using the alternate mechanism.
7. On success, transition to `terminated` and release indexes.
8. On failure, transition to `orphaned`, retain the PID/record, emit diagnostics, and schedule the reaper.

A later enhancement may use a Windows Job Object with kill-on-close semantics. The broker contract must allow that adapter to replace `taskkill` without changing clients.

### 9.2 macOS and Linux

Terminate the PTY/process group, wait for graceful exit, escalate to a forceful signal after a bounded grace period, and verify process death before releasing the record.

---

## 10. Persistence and Retention

The broker keeps active state in the run service and writes lightweight recovery snapshots under the existing TideCode data directory. Persisted data excludes environment variables, secrets, and unredacted credentials.

Persist:

- Session/operation identifiers and lifecycle state.
- Shell metadata, cwd, timestamps, exit code, and termination provenance.
- A bounded sanitized transcript tail and output cursor.
- Attachment/lease metadata required for recovery.

Do not persist:

- Complete process environments.
- Authentication tokens.
- Arbitrary stdin values marked sensitive.
- Unlimited terminal scrollback.

On service restart, previously running records become `session_lost` unless the implementation can prove and safely reattach to an owned process. Stale live PIDs are sent to the orphan reaper only when ownership metadata matches.

---

## 11. Planned File Boundaries

New modules should keep contracts, state transitions, I/O, process control, transport, and compatibility mapping separate.

```text
electron/terminal/broker/
├── contracts.ts                # Broker domain types and request/result contracts
├── stateMachine.ts             # Pure session/operation transition validation
├── outputStore.ts              # Cursor-based bounded output retention
├── processTermination.ts       # Platform termination adapter and verification
├── persistence.ts              # Sanitized recovery snapshot storage
├── terminalBroker.ts           # Broker orchestration and public domain API
└── terminalBrokerEvents.ts     # Typed event publication

electron/runService/
├── protocol.ts                 # Broker request/event wire contracts
├── server.ts                   # Authenticated dispatch to broker
├── client.ts                   # Desktop/CLI broker client methods
└── terminalClientBridge.ts     # Terminal event subscription and reconnect

electron/chat/shared/tools/
├── terminalBrokerAdapter.ts    # AI alias and operation mapping
├── executeTerminalTool.ts
├── readTerminalTool.ts
├── interactTerminalTool.ts
└── terminateTerminalTool.ts

src/types/chat/
├── terminalBroker.ts           # Renderer-safe public terminal types
├── runtime.ts                  # Typed cancellation and interruption results
└── apis.ts                     # Compatibility API surface
```

Existing terminal UI components remain presentation-only and are not merged into broker modules.

---

## 12. Migration Phases

### Phase 1: Contracts and pure state

- Add terminal session/operation/cancellation contracts.
- Add validated state transitions and output cursor storage.
- Add unit tests without starting PTYs.

### Phase 2: Broker and process lifecycle

- Wrap current node-pty creation in the broker.
- Implement verified cross-platform termination.
- Add retained records, leases, and orphan reaping.
- Add broker-level tests with injectable PTY and process adapters.

### Phase 3: Run-service transport

- Add protocol methods and terminal events.
- Instantiate one broker in the run-service server.
- Add authenticated client methods and reconnect subscriptions.

### Phase 4: AI migration

- Replace turn-local process ownership with the broker adapter.
- Preserve numeric session aliases for model compatibility.
- Store durable IDs in structured tool results.
- Apply typed cancellation policy from chat runtime.

### Phase 5: Desktop terminal migration

- Proxy terminal IPC through the run-service client.
- Reattach tabs using durable IDs and output cursors.
- Remove Electron-main PTY ownership after compatibility tests pass.

### Phase 6: Cancellation provenance and history

- Extend cancellation requests with typed provenance.
- Persist cancellation fields in canonical history.
- Differentiate partial tool requests from executing tools.
- Render accurate user-facing status messages.

### Phase 7: Recovery, cleanup, and removal

- Add broker snapshot restoration and stale-record handling.
- Remove obsolete module-level terminal registries and turn cleanup paths.
- Add startup health checks for node-pty and shell resolution.

---

## 13. Test Matrix

### Domain tests

- All legal and illegal session state transitions.
- All legal and illegal operation state transitions.
- Monotonic output cursors, truncation, and replay.
- Lease expiry and multi-client attachment.

### Broker tests

- Visible and AI clients attach to broker-owned sessions.
- Disconnect and reconnect preserve session/output identity.
- Command success, nonzero exit, prompt interaction, and session loss are distinct.
- Explicit Stop applies termination policy and preserves final output.
- Failed termination retains an orphan record and retries.
- Windows nonzero `taskkill` status invokes the PTY fallback.
- Registry removal occurs only after verified termination or retained orphan transition.

### Runtime tests

- Cancellation during tool-input streaming produces `tool_request_cancelled`.
- Cancellation during executor work produces `tool_execution_cancelled`.
- Cancellation provenance reaches canonical `run_aborted` history.
- A provider failure is not mislabeled as user Stop.
- A command failure is not mislabeled as terminal infrastructure failure.

### Integration tests

- Desktop terminal API compatibility.
- AI execute/read/interact/terminate compatibility.
- PowerShell 7 selection and CMD fallback behavior.
- Run-service reconnect and terminal event replay.
- Run-service shutdown cleans all PTYs or records cleanup failures.

---

## 14. Acceptance Criteria

Implementation is complete when:

1. The run service is the only production process that creates TideCode PTYs.
2. Visible and AI terminals use the same broker and shell resolver.
3. Every terminal session and command has a durable broker ID.
4. Clients can query and reattach to sessions independently of a chat stream.
5. Client disconnection does not silently cancel a run or lose terminal state.
6. Explicit cancellation records its reason and applies a deterministic terminal policy.
7. Partial tool-call cancellation is not shown as terminal execution failure.
8. Nonzero command exit is distinct from terminal infrastructure failure.
9. Windows cleanup checks termination results, falls back, verifies exit, and retains orphan state on failure.
10. Completed/cancelled terminal evidence remains queryable for the configured retention period.
11. Existing built-in terminal and AI terminal user flows remain compatible.
12. Typecheck and the terminal/runtime/run-service test suites pass; unrelated pre-existing lint failures are reported separately.

---

## 15. Rollout and Compatibility

- Land contracts and broker behind the existing run-service boundary first.
- Preserve renderer and model-facing APIs during migration.
- Do not maintain two active PTY owners after the desktop bridge is enabled.
- Include a startup compatibility check that rejects an old run-service build lacking broker protocol support and restarts it through the existing build-mismatch path.
- Retain structured diagnostics so failures can be classified as shell resolution, PTY loading, command failure, cancellation, transport disconnection, or cleanup failure.
- Avoid destructive migration of user history; new cancellation and terminal metadata are additive.

---

## 16. Implementation Checklist

- [x] Add public and internal broker contracts.
- [x] Add pure state machines and output store.
- [x] Add platform process termination adapter with verification.
- [x] Add terminal broker orchestration, disconnect leases, retention, and orphan reaper.
- [x] Add broker persistence and startup recovery.
- [x] Extend run-service protocol/server/client.
- [x] Add terminal event forwarding and reconnect replay.
- [x] Migrate AI terminal tools and compatibility aliases.
- [x] Migrate desktop terminal IPC to the broker.
- [x] Add typed chat cancellation provenance.
- [x] Correct interrupted-tool result taxonomy and UI copy.
- [x] Remove direct Electron-main and chat-turn PTY ownership; retain the low-level registry only as the broker's PTY adapter.
- [x] Add domain, broker, runtime, and integration coverage.
- [x] Add startup shell/native-module fail-fast behavior.
- [x] Run typecheck, production run-service bundling, and the complete test suite.
- [x] Update this plan's status and checklist with verification evidence.

---

## 17. Verification Evidence

- `npm run typecheck`: passed.
- `npm test`: passed all 1,214 tests.
- `npm run build:cli`: passed and produced the Electron run-service bundle, Electron CLI bundle, and standalone CLI/runtime bundles.
- Targeted broker/runtime/terminal tests: passed 48 of 48.
- `git diff --check`: passed.
- `npm run lint`: continues to report the repository's existing 25 findings (22 errors and 3 warnings). No new broker files are included in that finding list.

The recovery snapshot intentionally does not pretend that a PTY can be reattached after the run-service process itself dies. On service restart, retained active records become `session_lost`, while their bounded transcript and lifecycle metadata remain queryable. Renderer or CLI transport reconnects to the still-running service reattach normally through the durable broker session ID and output cursor.
