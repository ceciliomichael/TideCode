# Changelog

## 1.0.9 — More dependable Windows updates and a tighter workspace layout

TideCode now handles Windows updates and reinstalls more reliably while keeping the workspace sidebar compact.

- Recovered existing per-user and per-machine installation locations from legacy Windows uninstall metadata when the primary installer record is missing.
- Kept fresh installs on the native Windows installer flow while letting confirmed in-app updates continue directly and relaunch TideCode after installation.
- Removed extra bottom spacing above the sidebar content for a more consistent navigation layout.

## 1.0.8 — More reliable terminal output and clearer update downloads

TideCode now keeps long-running AI terminal work observable while making update discovery feel immediate and informative.

- Kept release details and Markdown notes visible as soon as a packaged update begins downloading, while progress continues in the background.
- Preserved complete pending output for AI terminal sessions even when the visible terminal buffer rolls over, so long-running commands are less likely to lose output between reads.
- Allowed terminal reads to wait for longer-running commands without the previous polling cap interrupting the agent’s workflow.
- Renamed the `execute_terminal` operation field from `mode` to `action` and updated tool guidance, status labels, and validation to use the clearer contract.
- Added regression coverage for retained terminal output, extended waits, action-based terminal operations, and update-download presentation.

## 1.0.7 — Safer workspace search and accurate diffs

TideCode now keeps repository instruction files out of AI file discovery and reports file changes more accurately across line-ending styles and larger files.

- Excluded `AGENTS.md` files from AI list, glob, grep, and ripgrep fallback results while preserving normal workspace instruction support.
- Improved added and removed line counts for CRLF/LF files and larger edits.
- Added regression coverage for protected instruction files, line-ending normalization, and large-file diff summaries.

## 1.0.6 — Clearer workspace selection

Workspace Explorer selections now keep their text at the strongest readable contrast against the TideCode selection background.

- Improved selected, active, context, and drop-target row readability in Workspace Explorer.

## 1.0.5 — Smoother updates and more reliable tool edits

TideCode now makes both app updates and model-driven file edits easier to finish without extra friction.

- Kept the branded Windows installer visible during an in-app update while automatically continuing the already-confirmed update without a second confirmation click.
- Made the title-bar restart action clickable and placed it immediately to the right of the TideCode wordmark.
- Improved compatibility for batch edit tool calls that repeat the same file path inside each edit item.
- Added clearer edit-tool guidance and deduplicated missing-argument diagnostics.
- Added regression coverage for same-file batch edit normalization and invalid mixed-path requests.

## 1.0.4 — Faster restart installs

TideCode now moves directly from a downloaded update to installation, so restarting feels like one clear action instead of another update step.

- Made `Restart to update` hand the already-downloaded release directly to the silent installer.
- Relaunches TideCode automatically after installation finishes.
- Prevented repeated restart clicks from starting multiple installer handoffs.
- Documented the restart-to-install behavior for future release work.

## 1.0.3 — Reliable updates and smoother installs

TideCode now makes the final step of updating easier to understand and harder to interrupt, from the first manual check through the installer handoff.

- Added a dedicated `Check again` action that always requests the latest release from GitHub instead of reusing a cached network response.
- Kept the once-per-session automatic check behavior, so returning to Updates from the main workspace stays instant and predictable.
- Removed the duplicate `Restart to update` action from release details; the primary update action and the title-bar prompt now provide the clear restart path.
- Added a persistent restart prompt beside the TideCode wordmark whenever a downloaded update is waiting.
- Preserved downloaded-update readiness when users manually refresh release information.
- Fixed the quit handoff so TideCode does not block `electron-updater` while it launches the installer.
- Replaced duplicate `Check again` and `Check for updates` controls with one context-aware action.
- Prevented concurrent update downloads from resetting progress or downloading the same release twice.

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
