# Changelog

## 1.0.20 — Richer workspace previews

TideCode now brings common visual and document files into the workspace, with dedicated previews and more consistent provider model controls for current backend capabilities.

- Preview browser-supported images, PDF files, and DOCX documents directly in workspace tabs with loading, error, caching, zoom, pan, and page navigation support.
- Preserve existing editor, Markdown, SVG, and workspace navigation flows while routing supported files to the appropriate preview surface.
- Refresh provider model catalogs and reasoning metadata, including expanded supported effort choices and current model identifiers.

## 1.0.19 — More accurate provider model controls

TideCode now keeps provider model choices aligned with the capabilities and identifiers exposed by current backends, making reasoning controls more predictable across DeepSeek and Google providers.

- Adds DeepSeek low, medium, and high reasoning choices with the correct backend translation, including an explicit option to disable thinking.
- Refreshes the built-in Google Gemini Flash and Flash-Lite model identifiers.
- Preserves configured API keys in provider status responses so provider settings remain accurate after reloads.

## 1.0.18 — Cleaner sidebar project filter

The sidebar thread filter stays focused on the projects that matter: the Archived option only appears once a thread has actually been archived.

- Hides the Archived option from the sidebar filter dropdown until at least one chat is archived.
- Returns the sidebar to All projects automatically when the last archived chat is unarchived while the Archived view is active, instead of leaving it on a hidden, empty filter.

## 1.0.17 — Smoother chat cleanup and interruption

TideCode now keeps chat cleanup and interruption behavior predictable while making live thinking output easier to read.

- Hides the thinking panel scrollbar without removing scrolling.
- Clears the active draft when its conversation is archived, avoiding stale composer content.
- Settles sends aborted before streaming starts without waiting for a stream transition.

## 1.0.16 — Reliable multiline terminal commands

TideCode now preserves multiline PowerShell commands when AI sends them through the terminal, so commit messages and other structured commands execute as intended instead of entering an invalid continuation state.

- Encodes multiline PowerShell input into one PTY line and decodes the exact original command in the active shell.
- Adds regression coverage for multiline commit-style commands and their embedded validation text.

## 1.0.15 — Terminal commands that report completion

TideCode now waits for AI terminal commands to actually finish before returning their output, so long-running commands no longer come back truncated, and same-file edits can no longer conflict with each other.

- Terminal reads keep polling until the queued command completes (up to five minutes) and report command completion, instead of returning after a fixed wait window.
- AI terminal sessions no longer terminate after five idle minutes, so long-running work stays alive within the turn that started it.
- Concurrent edits to the same file are applied one at a time, so parallel tool calls can no longer drop each other's changes.
- Compaction dividers appear before the first message created after a compaction, and a fresh assistant block starts after compaction instead of continuing the previous draft.
- Finished assistant work keeps tool-only messages inside the collapsed group, showing only the final text outside it.

## 1.0.14 — One clean update download

Update checks with automatic downloads enabled now download the installer once, with a single continuous progress run, instead of filling to 100%, resetting to 0, and downloading again.

- Downloads the full installer directly instead of the differential-installer path that silently restarted from 0 when patching the previously cached installer failed.
- Reports the real download state from every update check, so a completed update stays ready at 100% instead of appearing to restart, and a mid-download check continues from its actual progress.
- Ignores redundant download requests for a version that is already downloading or downloaded.

## 1.0.13 — More reliable terminal turns and thread creation

TideCode now keeps AI terminal work scoped to the turn that started it while preserving the correct project context when users begin new threads from the sidebar.

- Keeps background AI terminal sessions addressable with unique visible session IDs, including when several commands run during one turn.
- Terminates every AI terminal session created by a completed or interrupted turn, including unfinished commands, without affecting sessions from other turns.
- Starts new threads in the active or selected project, including Chats, and keeps thread search input free of browser search affordances.

## 1.0.12 — More dependable context and update recovery

TideCode now keeps long-running conversations usable while making context recovery and update discovery more resilient.

- Automatically compacts completed conversation work at safe user and tool boundaries, using the same context accounting shown in the chat UI and preserving tool-call/result pairs.
- Keeps compaction markers and context usage current after a compaction commits, while removing internal execution-mode details from compacted and replayed conversation state.
- Restores previously discovered release notes when Settings reopens, retains update progress behavior, and avoids stale floating-menu placement during quick interactions.
- Added regression coverage for automatic compaction, retained update metadata, marker placement, execution-mode sanitization, and context usage estimates.

## 1.0.11 — Archived chats and a steadier commit workflow

TideCode now gives users more control over chat history and a clearer, more reliable path from local changes to commits and pull requests.

- Added archive and unarchive actions with an Archived filter, project context in archived rows, a dedicated empty state, and automatic restoration when an archived thread receives a new message.
- Kept archived threads out of pinned views and return the sidebar to All projects when a resumed archived thread becomes active again.
- Improved the Commit your changes modal with reliable branch overrides, automatic creation of missing branches, editable spaces that normalize at commit time, clearer pull-request language, stable selection styling, theme-safe text, and no unnecessary refresh animation.
- Strengthened Agent mode’s implementation contract while keeping Plan mode’s prompt scope separate, with regression coverage for both behaviors.

## 1.0.10 — Authenticated GitHub publishing and more deliberate planning

TideCode now makes it easier to publish a local workspace to GitHub while giving Plan mode a more deliberate, decision-focused planning workflow.

- Added GitHub device authorization with encrypted local token storage, repository creation, initial-branch setup, and authenticated first push from Source Control.
- Added validation and clear failure handling for repository names, descriptions, branches, remotes, workspace paths, expired sign-ins, and GitHub responses.
- Made Source Control choose the primary action from repository state: Commit while files need review, Publish to GitHub for a clean local repository without a remote, and Sync Changes for outgoing commits.
- Expanded Plan mode to investigate repository evidence, ask focused decision questions, surface tradeoffs, and converge on a confirmed scope before producing a plan.

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
