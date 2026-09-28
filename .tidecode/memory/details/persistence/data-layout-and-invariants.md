# TideCode Persistence and Data Layout

## Storage split

TideCode uses two kinds of persistence:

1. **Application-home state** under the Electron home directory, generally in `~/.tidecode/`. This stores app settings, provider configuration, conversation history, model catalogs, MCP state/configuration, Kanban boards, and checkpoint data.
2. **Workspace-local state** inside the selected project directory. This includes the durable memory system at `.tidecode/memory/`, workspace-visible project files, workspace skills, and any workspace-local configuration recognized by a subsystem.

A future change must first decide which category the data belongs to. User project knowledge and project-specific conventions belong in workspace memory; app-wide preferences and credentials belong in application-home state.

## Application-home paths

### Conversation history

`electron/history/paths.ts` defines the primary history root as `~/.tidecode/history/`:

- `<conversation-id>.json`: visible conversation records and message arrays.
- `messages.jsonl`: append-oriented message log.
- `folders.json`: conversation folder records and ordering.
- `agent-contexts/`: virtual agent-context directories.
- `agent-contexts/VIRT_draft/`: draft context used before a conversation is attached to a project folder.

Conversation folders point to user-selected project directories. Agent and plan conversations resolve their execution root from the folder path when available, otherwise they use a virtual context directory.

### Canonical chat history

`electron/chat/history/eventStore.ts` stores canonical replay documents under `~/.tidecode/history/canonical-history/<conversation-id>.json`. This is distinct from the visible conversation record. It records synchronized message identities/digests, branches, context epochs, run start/completion/failure/abort events, per-step provider records, compaction packets, replay projections, usage totals, and tool freshness.

Canonical documents are written atomically, use per-conversation update queues, recover from `.bak` files, and quarantine invalid documents rather than silently trusting corrupted state. Chat runtime work should preserve this separation and should not replace canonical history with a renderer-only snapshot.

### Settings and providers

`electron/settings/store.ts` uses `~/.tidecode/config/`:

- `settings.json`: durable application settings such as appearance, language, provider/model selections, terminal mode, update behavior, compaction settings, and feature flags.
- `workspace-ui-state.json`: UI state such as panel sizes, selected project, last active conversation/folder, source-control layout, terminal visibility/heights, and conversation-scoped UI sessions.
- `providers.json`: API-key provider configuration and custom provider metadata, written through the provider store.

Settings are sanitized on load, merged with defaults, split between durable and workspace-UI state, and written using an atomic JSON writer. The `TIDECODE_SETTINGS_HOME` environment variable can override the settings home for tests or isolated runs. Provider credentials must never be copied into logs, memory files, or user-visible diagnostics.

### Model catalogs

`electron/models/store.ts` uses `~/.tidecode/models/<provider-id>.json` for versioned user model catalogs. It migrates legacy custom model data from `~/.tidecode/config/custom-models.json` and from older provider records when needed. Catalog entries are sanitized and mutations are serialized through a queue.

### MCP

`electron/mcp/configStore.ts` uses `~/.tidecode/mcp/mcp.json` for TideCode-managed MCP configuration and also reads compatible global configs from provider-specific directories such as `.codex`, `.agents`, and `.claude`. `electron/mcp/stateStore.ts` stores auto-connect state in `~/.tidecode/mcp/state.json`, keyed globally or by normalized workspace path. Legacy workspace-local MCP state is migrated into the global state file.

MCP configurations can be read-only when managed by another owner. TideCode must reject edits to those entries instead of overwriting external configuration.

### Kanban

`electron/kanban/paths.ts` uses `~/.tidecode/kanban/`:

- `boards/<sha256-of-normalized-workspace-path>.json`: one persisted board per workspace.
- `checkpoints/`: Kanban checkpoint support.

Board files contain cards, revision, schema version, update time, and the workspace path. Board mutations are serialized per workspace, increment revisions, and notify watchers.

### Workspace checkpoints

Workspace checkpoints are created under the history storage root in `workspace-checkpoints/<checkpoint-id>/` with a `manifest.json` and a `snapshots/` directory. A manifest records the workspace root, captured relative paths, whether entries existed, directory state, missing parent directories, and file snapshot names. Restoring a checkpoint reverses file changes and can restore a captured Kanban board snapshot as well.

## Workspace memory layout

The durable memory service is implemented in `electron/memory/service.ts` and is intentionally workspace-local:

- `.tidecode/memory/MEMORY.md`: generated index of memory entries.
- `.tidecode/memory/folders/<folder>/<entry>.md`: durable Markdown entries.

Entry paths must be workspace-relative, have at least `folders/<folder>/<name>.md`, use safe alphanumeric/period/underscore/hyphen segments, and must not contain symbolic links. Content is normalized Markdown, must be non-empty, is capped at 512 KiB per entry, and receives a top-level title when one is supplied. The service caps the collection at 1,000 entries.

Memory reads rebuild the index if needed. Writes, edits, and deletions run under a per-workspace lock and refresh the generated index. Forgetting an entry also removes empty ancestor directories beneath `.tidecode/memory/folders`, but never removes the managed `folders` root or any non-empty directory. Memory changes notify the workspace Explorer. The index is derived state; individual Markdown entries are the durable source documents.

## Persistence invariants

- Normalize and validate paths before reading or writing.
- Keep workspace-local data inside the workspace root unless a subsystem explicitly defines an application-home store.
- Reject path traversal and symlink-based escapes.
- Use atomic writes for JSON documents where interruption could corrupt state.
- Serialize mutations that can race: conversation history, canonical history, settings updates, models, Kanban boards, and memory.
- Preserve schema versions and migration behavior when changing persisted formats.
- Treat missing files as an explicit initialization case, not as permission to infer arbitrary data.
- Keep generated indexes synchronized with their source entries.

Verified against the persistence path modules and stores on August 11, 2026. Paths are implementation facts and should be rechecked if storage migration work changes them.
