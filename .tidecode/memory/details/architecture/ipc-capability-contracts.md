# TideCode IPC and Capability Contracts

## Boundary model

The renderer does not directly access Node.js, Electron filesystem APIs, provider credentials, native PTYs, Git subprocesses, or MCP transports. It calls typed APIs exposed by `electron/preload.ts`. The preload layer forwards requests over named IPC channels and unwraps event payloads into renderer-friendly callbacks.

The safe architectural rule is:

`React/hooks -> window.tidecode* typed API -> preload IPC mapping -> ipcMain handler -> Electron service/domain module -> typed result or event`

New capabilities should follow this flow instead of exposing broad unrestricted Electron APIs.

## Public renderer APIs

The main exposed namespaces and responsibilities are:

- `tidecodeHistory`: conversation and folder listing, creation, message append/replace, title/archive/pin updates, compaction markers, checkpoints associated with user messages, and draft agent context lifecycle.
- `tidecodeSettings`: initial launch settings plus durable settings read/update.
- `tidecodeProviders`: provider status, Codex OAuth/account operations, API-key provider save/remove, and provider state change subscriptions.
- `tidecodeModels`: built-in provider model listing and custom model catalog CRUD.
- `tidecodeMcp`: MCP server CRUD, connect/disconnect/refresh, state reads, tool enable/disable, and MCP state change subscriptions.
- `tidecodeSkills`: skill creation and skill discovery for a workspace.
- `tidecodeChat`: start/cancel chat streams, manual compaction, context usage estimates, tool-decision submission, and stream-event subscriptions.
- `tidecodeKanban`: board reads, card/task CRUD, movement/reordering, import/clear operations, AI task planning, and board change subscriptions.
- `tidecodeGit`: status, diffs, branches, history, staging, commits, sync, initialization, GitHub authentication, publishing, and source-control watch subscriptions.
- `tidecodeWorkspace`: Explorer reads/writes and mutations, refactor candidate listing, file watching, clipboard image import, and workspace checkpoint create/restore/redo operations.
- `tidecodeTerminal`: PTY session create/write/resize/close, external HTTP(S) link opening, and terminal data/exit subscriptions.
- `tidecodeClipboard`: file-path extraction from the native clipboard.
- `tidecodeFileDrop`: conversion of browser `File` objects to native paths through Electron `webUtils`.

The exact TypeScript contracts are primarily defined in `src/types/chat/apis.ts` and related files under `src/types/chat/`, `src/types/mcp.ts`, `src/types/skills.ts`, and `src/types/updates.ts`.

## IPC registration modules

`electron/main.ts` registers these modules after `app.whenReady()`:

1. `registerCoreIpcHandlers`: history, settings, skills, Kanban, providers, and models.
2. `registerChatGitTerminalIpcHandlers`: chat streams/compaction, terminal sessions, Git operations, and source-control watches.
3. `registerWorkspaceIpcHandlers`: workspace Explorer, clipboard file/image handling, and checkpoints.
4. `registerMcpHandlers`: MCP server operations through the singleton server manager.
5. `registerUpdatesIpcHandlers`: update checks, downloads, cached release state, and restart-to-update.

Each handler should remain a thin adapter. Validation and behavior belong in the imported service/domain module, not in the registration file unless the check is specifically about the IPC event boundary.

## Event and subscription pattern

Preload subscription methods wrap Electron events and return an unsubscribe function. Renderer hooks must retain and call that cleanup function when dependencies change or components unmount. Existing event channels include:

- `chat:stream:event`
- `providers:stateChanged`
- `mcp:stateChanged`
- `kanban:changed`
- `git:sourceControl:changed`
- `workspace:explorer:changed`
- `terminal:session:data`
- `terminal:session:exit`
- `updates:stateChanged`

Events should carry typed payloads and should not expose secrets, raw credentials, or unnecessary personal data.

## Chat stream ownership

When `chat:stream:start` is handled, `registerChatGitTerminalIpcHandlers` chooses the Codex or API-key runtime from `providerId`, records the stream-to-provider mapping, and returns a stream ID. Cancellation and tool-decision requests use that mapping to route to the correct runtime. If ownership cannot be determined, the operation fails rather than guessing.

Stream events are emitted asynchronously from the main process. The normal lifecycle includes `started`, model/tool progress events, optional compaction events, and `completed`; aborts and failures use explicit terminal events. The shared runtime also persists canonical history while streaming, so the renderer must not be treated as the sole source of truth for completed chat state.

## API extension checklist

For a new protected capability:

1. Define the input/result/event types in the appropriate `src/types` module.
2. Add a narrow method to the relevant public API interface.
3. Map the method in `electron/preload.ts` to a uniquely named channel.
4. Register the channel in the correct `electron/ipc/register*` module.
5. Implement validation, authorization/ownership, and side effects in a dedicated Electron service.
6. Add renderer state/hook wiring and unsubscribe cleanup.
7. Add focused tests for validation, routing, error behavior, and event cleanup.
8. Verify `npm run typecheck`, the focused test, and proportionate build/lint checks.

Avoid exposing `ipcRenderer` as a general-purpose application API. The existing raw bridge is an Electron primitive, while the `tidecode*` namespaces are the intended product contracts.

Verified against `electron/preload.ts`, the five IPC registration modules, and `src/types/chat/apis.ts` on August 11, 2026.
