# TideCode System Overview

## Purpose

TideCode is a local-first Electron desktop AI workspace for software work. Its product identity is a single environment where conversation, project files, terminal work, planning, source control, model configuration, and review stay together. The durable product goal is to reduce context switching without sacrificing inspectability or user control.

The assistant supports two explicit working modes:

- **Plan mode**: understand the project, investigate, decompose work, and prepare a reviewable approach.
- **Agent mode**: interact with the workspace and carry out implementation-oriented work through tools.

The application should continue to feel like a project-oriented workbench rather than a generic chatbot.

## Runtime architecture

TideCode is split into the standard Electron layers:

1. **Renderer** (`src/`): React UI, hooks, view models, client-side state, presentation, and pure browser-safe utilities.
2. **Preload bridge** (`electron/preload.ts`): the typed capability boundary exposed to the renderer through `contextBridge`.
3. **Electron main process** (`electron/`): filesystem access, provider clients, model adapters, terminal sessions, Git, MCP, workspace watchers, persistence, and lifecycle management.

The Vite configuration builds the renderer, Electron main entry point (`electron/main.ts`), and preload entry point (`electron/preload.ts`). `node-pty` is intentionally externalized from the main-process bundle so its native loader resolves correctly at runtime.

## Main entry points

- `src/main.tsx` imports global CSS, schedules Monaco preloading, and mounts `App` in React `StrictMode`.
- `src/App.tsx` owns the top-level screen switch (`chat` or `settings`), app settings bootstrap, provider state, conversation launch preference persistence, document theme, and the composition of `ChatInterface` and `SettingsInterface`.
- `electron/main.ts` configures the Electron profile, enforces a single instance per dev/packaged flavor, registers IPC handlers, initializes providers, starts the MCP manager, creates the application window, and disposes watchers, terminal sessions, settings writes, and MCP resources during shutdown.
- `electron/preload.ts` maps typed renderer APIs to named IPC channels and exposes them as `tidecodeHistory`, `tidecodeSettings`, `tidecodeProviders`, `tidecodeModels`, `tidecodeMcp`, `tidecodeSkills`, `tidecodeChat`, `tidecodeKanban`, `tidecodeGit`, `tidecodeWorkspace`, `tidecodeTerminal`, `tidecodeClipboard`, and `tidecodeFileDrop`.

## Main subsystems

### Chat and agent runtime

`electron/chat/` contains provider-specific clients and shared execution infrastructure. Codex and API-key providers each have a runtime that validates provider ownership, creates an abortable stream, and delegates actual tool-enabled execution to `electron/chat/shared/runtime.ts`.

The shared runtime is responsible for:

- Loading enabled skills.
- Building agent tools for the selected workspace and chat mode.
- Applying deterministic tool ordering and provider prompt-cache policies.
- Building the system prompt and model messages.
- Synchronizing visible messages into canonical history.
- Recording context epochs, runs, steps, compactions, freshness changes, and terminal outcomes.
- Running the model/tool loop until the provider stops.
- Emitting stream lifecycle events to the renderer.
- Terminating background terminal sessions created for the turn.

### Conversation history

`electron/history/` stores saved conversations, folders, draft agent context, and conversation-level workspace roots. The visible conversation document and canonical event history are separate representations. The canonical history is used for replay fidelity, context epochs, compaction, usage, branches, and freshness tracking.

### Workspace and editor

`electron/workspace/` provides safe path normalization, file and directory operations, Explorer watches, clipboard image import, refactor candidate discovery, and workspace checkpoints. Workspace-relative paths must remain inside the selected workspace root. Checkpoints snapshot file state and may include Kanban board state.

### Planning and Kanban

`electron/kanban/` persists a workspace-specific board, serializes concurrent mutations, increments revisions, emits board change events, and maintains parent-task completion state from child cards and acceptance criteria. `src/lib/kanban` contains the domain contracts and pure transformations.

### Git and source control

`electron/git/` wraps repository inspection and mutation: status, diffs, branches, history, staging, commits, sync, repository initialization, GitHub authentication, and publishing. Source-control watches notify the renderer when the repository changes.

### Providers and models

`electron/providers/` manages Codex OAuth/account state and API-key provider configuration. `electron/models/` manages built-in provider catalogs and user-defined model catalogs with migration support. Provider state is cached and refreshed in the background.

### MCP and skills

`electron/mcp/` manages MCP configuration, server lifecycle, tool discovery, tool identity, tool metadata, and enabled/disabled tool state. `electron/skills/` discovers `SKILL.md` files from workspace and global roots, parses lightweight front matter, deduplicates by skill name, caches discovery briefly, and loads enabled skills into the agent runtime.

### Terminal

`electron/terminal/` owns native PTY sessions through `node-pty`. Sessions are associated with the owning renderer window and workspace, enforce ownership checks, clamp dimensions and polling, validate working directories, support virtual-environment activation, stream output and exit events, and clean up AI-created sessions after a turn.

## Design principles to preserve

- Keep the user’s goal visible and the work reviewable.
- Keep planning and acting distinguishable.
- Put side effects in the Electron main process or isolated services.
- Keep renderer contracts typed and narrow.
- Prefer workspace-relative, validated paths over arbitrary filesystem access.
- Preserve canonical history and replay fidelity when changing chat behavior.
- Serialize mutations for conversations, memory, Kanban boards, and other stateful stores.
- Treat model/provider output and workspace content as untrusted input.
- Do not add new product scope merely because a subsystem could be generalized.

## Repository conventions

- Renderer types and public API contracts live primarily under `src/types/`.
- Pure domain utilities live under `src/lib/`.
- React composition lives under `src/pages/`, `src/components/`, and `src/hooks/`.
- Electron side effects and services live under `electron/` grouped by capability.
- IPC registration is intentionally separated into five files: core, chat/Git/terminal, workspace, MCP, and updates.
- Tests use Node’s test runner through `tsx` and are organized by subsystem under `tests/`.

Verified against the repository on August 11, 2026. Future work should re-check source files before relying on this map because this entry describes architecture, not an authoritative generated schema.
