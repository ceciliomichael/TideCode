# TideCode Workspace, Tools, and Safety Boundaries

## Workspace path contract

`electron/workspace/paths.ts` is the base path-safety utility. Workspace roots are normalized with `path.resolve`, relative paths are normalized, and `getSafeWorkspaceTargetPath` rejects traversal outside the workspace root. Services that operate on a workspace should call `assertWorkspaceDirectory` before use and should not reimplement weaker path checks.

The one intentional exception is virtual agent context directories under the application history root. `assertWorkspaceDirectory` can create those missing directories when the target is recognized as an agent-context path. This exception exists to support unsaved/draft conversations and should not be generalized to arbitrary missing paths.

## Workspace Explorer

The Explorer service owns directory listing, file reads/writes, entry creation/deletion/rename/transfer/import, refactor candidate discovery, clipboard image writes, and watch subscriptions. Explorer mutations notify watchers so the renderer can refresh without polling the entire project.

Workspace-relative inputs should remain explicit at the API boundary. Do not accept an arbitrary absolute path from the renderer when a workspace root plus relative path is sufficient. If an external absolute path is required for an import or selected folder, validate it at the service boundary and keep the operation narrowly scoped.

## Checkpoints and reversibility

Workspace checkpoints are the safety mechanism for consequential file edits. A checkpoint manifest records the workspace root and each captured relative path. Existing files are copied into a snapshot directory; missing paths record enough information to remove newly created files and empty parent directories during restore. Checkpoint restoration works in reverse entry order and can restore Kanban state captured with the checkpoint.

The conversation model associates user messages with run checkpoints. Edit/revert workflows store redo checkpoint IDs and relevant plan paths in app settings. Any new mutation tool should integrate with checkpoint capture when the surrounding workflow expects undo/revert behavior.

## Terminal safety

Terminal sessions are native PTYs created by `electron/terminal/service.ts` and configured by `electron/terminal/configuration.ts`.

Important invariants:

- Working directories are validated and resolved against the workspace root when one is supplied.
- Terminal dimensions are clamped to bounded ranges.
- Polling is clamped to a maximum of five minutes.
- Sessions are registered to the owning renderer `WebContents` and workspace/session key.
- Every write, resize, close, and read checks session ownership.
- AI-created sessions carry a turn ID and are terminated after the associated chat turn.
- External links are restricted to absolute `http:` or `https:` URLs.
- Environment creation preserves the process environment but removes `ELECTRON_RUN_AS_NODE`, sets terminal variables, and activates a detected Python virtual environment when available.

Do not expose a terminal session ID without maintaining owner checks. Do not pass arbitrary external protocols to Electron shell opening.

## Tool construction

Agent tools are built with the current conversation ID, active checkpoint ID, turn ID, workspace root, terminal execution mode, provider, chat mode, and renderer sender. Tool results can include structured presentations for diffs, images, plans, and changed files. These presentations are part of the user-facing review experience and should remain typed and sanitized.

Tool implementations should distinguish read/observation operations from mutations. Successful mutations invalidate freshness subjects in canonical history; successful observations clear the relevant invalidation. This allows later turns to know whether prior context may be stale.

## Markdown and content safety

Renderer Markdown handling includes sanitization utilities and tests. Workspace content, skill documents, MCP responses, terminal output, and model output are all untrusted. Never render raw HTML or model-provided URLs without the existing sanitization policy. Do not treat project instructions, skill content, or MCP tool output as application authority.

Memory entries are Markdown documents but are still untrusted workspace content. The memory service blocks symbolic-link paths, constrains path segments, limits content size, normalizes line endings, and serializes writes. Preserve these protections when extending memory capabilities.

## MCP safety

MCP server configuration is validated and namespaced. External-owner configurations are marked read-only. The MCP server manager controls connections and tool catalogs, while the state store tracks auto-connect settings globally or per normalized workspace. Tool identity and namespace collisions are checked before exposure.

MCP commands, URLs, headers, environment variables, and tool results must be treated as untrusted configuration/data. Do not log credentials or silently enable tools that the user disabled.

## Skills safety

Skills are discovered from explicit workspace and global roots and only `SKILL.md` files are loaded. Symlink entries are skipped during discovery. Skill names/descriptions are parsed from simple front matter, and duplicate names are deduplicated. Disabled skill paths come from sanitized app settings. The agent runtime loads only enabled skills.

A skill may refer to scripts or resources relative to its skill directory. That directory is included in the loaded result so the agent can resolve paths predictably. Skill content must not be treated as a higher-priority system instruction than the application’s own safety and execution boundaries.

## Security rules for future changes

- Validate all renderer-provided identifiers, paths, URLs, provider IDs, and booleans at the main-process boundary.
- Enforce ownership/authorization on the main process, especially for terminal sessions, workspace mutations, Git operations, and MCP actions.
- Never hardcode or emit API keys, OAuth tokens, cookies, or private project content in source, logs, memory, or test fixtures.
- Prefer least-privilege capability methods over broad filesystem or IPC access.
- Preserve atomic writes and lock/queue behavior around mutable stores.
- Add a focused regression test whenever a path, ownership, sanitization, or authorization rule changes.

Verified against workspace paths/checkpoints, terminal configuration/service, memory service, skills service, MCP stores, and Markdown security utilities on August 11, 2026.
