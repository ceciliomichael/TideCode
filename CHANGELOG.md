# Changelog

## 1.0.4 — A clearer update action

The Updates screen now keeps one clear primary action, so checking the latest release never competes with a second button that does the same thing.

- Replaced the duplicate `Check again` and `Check for updates` buttons with one context-aware action.
- Kept the manual check behavior fully fresh while preserving the once-per-session automatic check when returning to Settings.

## 1.0.3 — Reliable updates and smoother installs

TideCode now makes the final step of updating easier to understand and harder to interrupt, from the first manual check through the installer handoff.

- Added a dedicated `Check again` action that always requests the latest release from GitHub instead of reusing a cached network response.
- Kept the once-per-session automatic check behavior, so returning to Updates from the main workspace stays instant and predictable.
- Removed the duplicate `Restart to update` action from release details; the primary update action and the title-bar prompt now provide the clear restart path.
- Added a persistent restart prompt beside the TideCode wordmark whenever a downloaded update is waiting.
- Preserved downloaded-update readiness when users manually refresh release information.
- Fixed the quit handoff so TideCode does not block `electron-updater` while it launches the installer.

## 1.0.2 — Safer updates and a polished installer

TideCode now gives users a clear, user-controlled path to discover and install releases from Settings, while the Windows installer keeps the experience branded, readable, and safe to repeat.

- Added a cached Updates settings view that checks the official TideCode GitHub release once per app session and allows a fresh manual check at any time.
- Added readable Markdown release notes with release links, version status, last-checked time, and download progress.
- Added user-controlled update downloads, disabled by default, so finding an update never downloads or installs it without explicit approval.
- Added cross-platform update downloads with a clear `Restart to update` step after the download completes.
- Added persisted update preferences and validation around release versions and updater requests.
- Added a branded Windows setup flow with clear Install/Update actions, richer TideCode copy, and bundled Google Sans Flex typography.
- Preserved the per-user installation path and shortcut identity during updates so existing taskbar pins continue to point to TideCode.
- Added high-density installer artwork and a generated asset step so Windows DPI scaling keeps the installer sharp.

## 1.0.1 — Dynamic tool discovery and execution

This patch release makes tool selection more reliable in natural-language requests and improves the handoff from model-generated arguments to tool execution.

- Improved dynamic tool search with stronger semantic matching, synonyms, and context-only query filtering.
- Added inferred search hints for custom tools based on their names, descriptions, and tags.
- Added a safe compatibility mapping for write calls that use `file` instead of the canonical `path` argument.
- Expanded dynamic-tool guidance and coverage for file search, editing, terminal work, task management, skills, and web research.
- Refined disabled-control colors across light and dark themes.

## 1.0.0 — First public release

TideCode brings the AI conversation and the project workspace together so software work can move from intent to reviewed change with fewer interruptions.

This release includes:

- Agent and Plan conversation modes.
- Project-scoped conversation history with folders and threads.
- Workspace file explorer, editor, search, replace, previews, and diff review.
- Integrated terminal with selectable execution modes.
- Git branches, status, diffs, staging, commits, history, sync, and GitHub publishing.
- Kanban planning with subtasks, labels, acceptance criteria, and AI-assisted task planning.
- Codex sign-in, API-key providers, custom models, model-specific task configuration, and reasoning controls.
- MCP server connections with tool controls.
- Reusable skills and workspace instruction support.
- Message attachments, file mentions, queued follow-ups, editing, reverting, context usage, and conversation compaction.
- Windows, macOS, and Linux desktop packaging.
