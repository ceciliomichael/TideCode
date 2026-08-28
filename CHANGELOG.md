# Changelog

## 1.2.26 - More reliable planning and background use

TideCode 1.2.26 keeps the app available from the system tray and makes planning, workspace instructions, context reporting, and settings handling more predictable.

- Keeps TideCode running from the system tray with a dedicated tray popup, so the app remains available when the main window is closed.
- Stabilizes Plan Mode around a persistent runtime contract while keeping Agent and Plan cache context aligned, with `plan_create` and `apply_patch` available under host-enforced plan-only mutation boundaries.
- Makes root `AGENTS.md` handling revision-aware, reusing instructions already read into model context and reading the file again only when its revision changes.
- Improves recoverable Code Mode inspection behavior and separates system-prompt and tool-schema token usage in the context indicator.
- Strengthens settings lock recovery and isolates development settings from the production app to reduce lock contention.
- Requires no manual migration or configuration changes.

## 1.2.25 - Safer patching and cleaner workspace workflows

TideCode 1.2.25 improves Code Mode resilience, multi-file patch reliability, workspace visibility, and everyday Kanban and settings behavior.

- Recovers the common Code Mode mistake of importing the already-injected `tools` binding while continuing to block real dynamic module loading.
- Makes `apply_patch` file commits atomic and retry-aware on Windows, with rollback limited to files that were actually changed.
- Tightens workspace ignore and search visibility behavior so reads, exploration, and fallback search stay consistent.
- Refines Kanban status handling, reasoning-effort choices, and update action presentation.
- Requires no manual migration or configuration changes.

## 1.2.24 - Unified Code Mode and more reliable tool workflows

TideCode 1.2.24 unifies Code Mode behavior across providers and makes multi-step tool execution, patching, and diff presentation more reliable.

- Uses one TideCode Code Mode instruction and tool contract across OpenAI, Codex, Google, Anthropic, Mistral, DeepSeek, and compatible providers, with provider-specific transport only.
- Keeps Codex and Luna sessions moving after Code Mode tool calls by preserving continuation context, sticky turn-state routing, pinned account state, and valid custom-tool replay.
- Improves `apply_patch` matching and recovery, patch wrapper tolerance, multi-hunk line numbers, and grouped per-file diff presentation.
- Tightens tool-result handling, prompt and cache accounting, workspace instruction loading, and Code Mode execution reliability.
- Requires no manual migration or configuration changes.

## 1.2.23 - Clearer update progress from the sidebar

TideCode 1.2.23 makes available and downloading updates easier to see from the sidebar and provides a direct restart action when an update is ready to install.

- Shows an update download percentage while the update is downloading.
- Changes the indicator to a restart action after the update is downloaded.
- Keeps the indicator hidden when no update is available and preserves accessible labels for each state.
- Requires no manual migration or configuration changes.

## 1.2.22 - More reliable terminals, updates, and Git workflows

TideCode 1.2.22 improves Windows terminal setup, update actions, chat behavior, file mentions, and Git-based workflows.

- Refreshes Windows terminal environments from user and machine registry PATH values, expanding variables and merging entries before shell creation.
- Improves update status and error presentation, chat scroll following, assistant drafts, and tool-invocation progress handling.
- Recognizes plain file mentions attached directly to preceding text while preserving label boundaries.
- Uses the preferred remote when checking default-branch ancestry and merge conflicts.
- Explains when a commit remains saved locally after pushing or creating a pull request fails.
- Requires no manual migration or configuration changes.

## 1.2.21 - Faster startup after installs and updates

TideCode 1.2.21 improves cold-start responsiveness, especially immediately after installing an update or launching a freshly installed build, by moving nonessential workspace initialization off the first-paint path.

- Creates the main window before starting saved-project path reconciliation so slow, missing, or numerous workspaces no longer delay the initial UI.
- Defers Monaco, Shiki, editor-view preloading, and all-workspace Git status and branch cache warming until startup has settled and the renderer is idle.
- Delays the fallback saved-project validation scan and reduces its polling frequency while preserving event-driven project-folder change detection.
- Requires no migration or configuration changes.
- Validated with 1,252 automated tests, TypeScript type checking, and the production build.

## 1.2.20 - Faster, more responsive terminal output

TideCode 1.2.20 keeps terminal-heavy workflows responsive by reducing CPU, memory, and message-processing overhead during high-volume command output without changing how AI terminal tools behave.

- Batches bursts of terminal output before downstream delivery to reduce IPC, renderer, and terminal rendering pressure during noisy commands.
- Uses bounded terminal history storage that avoids repeated full-buffer copying and prevents renderer replay history from growing indefinitely.
- Preserves output ordering, cursor and incremental-read semantics, command completion markers, interactive prompt handling, and existing AI terminal tool behavior.
- Requires no migration or configuration changes.
- Validated with 1,250 automated tests, TypeScript type checking, the production build, and pull-request CI.

## 1.2.19 — Current TideCode build refresh

TideCode 1.2.19 republishes the current stable application build with no product-behavior changes after 1.2.18.

- Keeps the Code Mode routing, compaction progress, and exploration presentation improvements from 1.2.18 available in a new release build.
- Requires no migration or configuration changes.
- Validated with TypeScript type checking and the production build; the full test command reaches the existing Codex fixture output but remains open without a completion summary in this environment.

## 1.2.18 — More reliable Code Mode routing and compaction progress

TideCode 1.2.18 keeps Code Mode requests on the correct execution boundary and makes completed exploration remain clearly completed as conversations are compacted.

- Repairs provider calls that incorrectly name an inner `tools.*` API by routing registered tools through the model-facing Code Mode executor.
- Clarifies that `tools.*` names are JavaScript APIs available only inside Code Mode, reducing provider-level tool routing mistakes.
- Finalizes pre-compaction exploration summaries after compaction commits so completed work is not shown as still active.
- Requires no migration or configuration changes.
- Validated with the full automated test suite, TypeScript type checking, the production build, and pull-request CI.

## 1.2.17 — Clearer tool output and recovery activity

TideCode 1.2.17 keeps internal recovery work out of the visible chat transcript and makes multiline Code Mode results easier to read.

- Hides internal `read_tool_output` recovery calls from tool summaries and rendered chat activity while preserving ordinary user-facing tool results.
- Preserves literal line breaks in explicitly returned Code Mode output instead of exposing escaped JSON text.
- Requires no migration or configuration changes.
- Validated with the full automated test suite, TypeScript type checking, the production build, and pull-request CI.

## 1.2.16 — More reliable assistant work and terminal sessions

TideCode 1.2.16 keeps long-running assistant work understandable and terminal sessions dependable across compaction, interruptions, and Desktop/CLI handoffs.

- Keeps assistant work grouped correctly across live and persisted compaction boundaries, so progress remains readable before and after context reduction.
- Distinguishes a tool request cancelled before execution from an accepted tool execution that was terminated, with clearer user-facing status.
- Centralizes visible and AI terminal ownership in the run-service broker with durable sessions, retained output, reconnect support, and verified cleanup.
- Isolates development run-service instances from packaged services so local development cannot replace the service that owns a packaged terminal process tree.
- Requires no migration or configuration changes.
- Validated with the full automated test suite, TypeScript type checking, the production build, and pull-request CI.

## 1.2.15 — Reliable workspace changes and surface-specific settings

TideCode 1.2.15 makes file changes safer, keeps Desktop, Web, and CLI preferences independent where they should be, and makes settings, terminals, and Code Mode more dependable across surfaces.

- Makes Code Mode execution reliable for concurrent and nested tool work, including returned promises, detached asynchronous calls, semantic failures, cancellation, MCP discovery, and bounded output.
- Hardens workspace edits, replacements, writes, and patch application with atomic multi-hunk behavior, stale-read protection, same-file serialization, ambiguity checks, line-range boundaries, safe path handling, and preserved BOM and line-ending formats.
- Adds clearer mutation failure stages and structured tool results so failed or partial file operations do not silently overwrite newer work.
- Separates Desktop, Web, and CLI settings while keeping shared configuration synchronized, migrates existing settings automatically, and preserves per-surface model, reasoning, follow-up, and terminal preferences.
- Adds stable loading and empty states for Settings sections and improves optimistic provider, model, Skills, and MCP updates so navigation does not jump while data is loading.
- Improves Windows terminal discovery by honoring configured shells, Windows Terminal profiles, installed PowerShell versions, Microsoft Store aliases, App Paths, and safe Command Prompt fallbacks; macOS and Linux continue to use the configured login shell when available.
- Keeps CLI and Desktop runtime settings, conversations, follow-ups, history, and model defaults aligned while retaining the controls that are intentionally surface-specific.
- Keeps source-control diff summaries based on the current working-tree snapshot so added and removed line counts stay accurate.
- Requires no manual migration or configuration changes; legacy settings are migrated automatically.
- Validated with 1,198 automated tests, TypeScript type checking, the production build, and pull-request CI.

## 1.2.14 - DeepSeek vision and reliable service refresh

TideCode 1.2.14 adds image-capable DeepSeek chat and makes desktop and CLI updates take effect reliably even when an older shared background service is still running.

- Adds DeepSeek V4 Flash Vision with image attachment support through the existing OpenAI-compatible message format.
- Keeps unknown DeepSeek models text-only unless the model catalog explicitly marks them as image-capable.
- Detects stale run-service builds, shuts them down safely, and starts the current build instead of silently reusing outdated background code.
- Requires no migration or configuration changes.
- Validated with 1,166 automated tests, TypeScript type checking, the production build, and pull-request CI.

## 1.2.13 — More reliable workspaces and smoother settings

TideCode 1.2.13 improves workspace navigation, remote and settings reliability, and the code editor experience across desktop and mobile.

- Adds TypeScript-aware Monaco navigation with module resolution, project diagnostics, hover information, and safer workspace file tracking.
- Makes Settings updates synchronize reliably across processes and keeps Skills and MCP content ready before navigation to reduce loading jumps.
- Improves mobile workspace controls and layout behavior, including smoother Settings navigation and more predictable chat and terminal interactions.
- Improves Code Mode and compaction recovery, preserving assistant work blocks and failing fast on unsupported tool execution.
- Adds AI-assisted Git publish and pull-request workflows, plus more reliable remembered remote web sessions.
- Requires no migration or configuration changes.
- Validated with the full automated test suite, TypeScript type checking, and the production build.

## 1.2.12 — Smoother mobile workspace interactions

TideCode 1.2.12 makes mobile chat and workspace interactions more reliable, especially while the on-screen keyboard, touch input, and asynchronous file mentions change the available layout.

- Keeps file mentions atomic when users tap mention options or delete them with native mobile Backspace and Delete input.
- Keeps file mention menus on a stable side while results load, preserves compact loading and no-match states, and restores the composer caret after deletion.
- Keeps the mobile workspace shell, composer, navigation, and interactive context indicators aligned with the visible viewport when the keyboard resizes the page.
- Requires no migration or configuration changes.

## 1.2.11 - Remote workspace and mobile web access

TideCode 1.2.11 adds secure browser access to the workspace running on your computer and introduces a phone-focused interface for chat, terminals, the work board, history, and settings.

- Adds Settings > Remote with a configurable network port, detected LAN and overlay addresses, and optional username/password authentication for browser access.
- Mirrors chats, terminal sessions, project files, source control, and the work board through the browser while execution continues on the laptop.
- Supports authenticated HTTPS reverse tunnels, including public tunnel hostnames whose traffic is forwarded locally to TideCode.
- Adds persistent mobile navigation for History, Chat, Terminal, Board, and Settings; mobile Terminal now waits for an explicit New terminal action, and the work board opens directly in its status-filter layout.
- Improves mobile file mentions, composer sizing, Settings navigation, dialogs, and board interactions while preserving the desktop workspace layout.
- On Windows, the installer manages a Private/Domain inbound firewall rule for TideCode and removes it during uninstall.
- Direct LAN Remote access remains HTTP, so use a trusted LAN or an encrypted/tunneled connection when transport confidentiality is required.
- Validated with 1,112 automated tests, TypeScript type checking, production builds, and focused 390x844 mobile runtime checks.

## 1.2.10 - Polished update and send controls

TideCode 1.2.10 refines the small action controls around updates and chat sending so their icons sit cleanly and consistently within the surrounding interface.

- Integrates the available-update shortcut directly into the Settings footer row, removes its tooltip and border, and keeps a dedicated click target that opens Settings > Updates.
- Uses pixel-aligned 16px icon geometry for the update shortcut so the download glyph is visually centered without manual translation offsets.
- Matches the chat send arrow to the same 16px, integer-stroke treatment for a cleaner centered appearance.
- Requires no migration or configuration changes.
- Validated with 1,102 automated tests, TypeScript type checking, and the production build.

## 1.2.9 - Cleaner update navigation

TideCode 1.2.9 keeps update status and controls in the dedicated Updates view while making the sidebar shortcut smaller, stable, and easier to understand.

- Replaces the sidebar update progress/status pill with a centered circular download icon that stays visually consistent while an update is available.
- Opens Settings > Updates directly from the sidebar update shortcut instead of starting, tracking, restarting, or otherwise controlling the update from the sidebar.
- Preserves the normal Settings button behavior and keeps download progress, installation, and restart controls in the Updates page.
- Requires no migration or configuration changes.
- Validated with 1,102 automated tests, TypeScript type checking, and the production build.

## 1.2.8 - Smoother updates, terminals, and shared chat

TideCode 1.2.8 makes desktop and CLI sessions feel like one continuous workspace, improves terminal interaction and startup continuity, and brings update checks into the normal app launch flow without redundant requests.

- Keeps live assistant output, queue and steer follow-ups, resumed conversations, and project registration synchronized between Desktop and CLI.
- Restores project and conversation context faster at startup, preserves the correct empty or existing-chat state, and fixes compact one-line code rendering.
- Improves CLI model defaults, composer visibility, reasoning and tool presentation, and interactive terminal input so child processes stay in the same PTY session.
- Checks for updates at launch when enabled, surfaces available downloads beside Settings, reuses the launch result when Updates is opened, and still checks on opening Updates when launch checking is disabled.
- Tightens Code Mode tool routing and recovers malformed generated terminal command quoting, while model requests use temperature 0.1 where the selected transport supports it.
- Requires no migration or configuration changes.
- Validated with 1,102 automated tests, TypeScript type checking, and the production build.

## 1.2.7 — Safer Code Mode and reliable CLI mentions

TideCode 1.2.7 hardens restricted Code Mode execution and makes restored CLI file references behave like normal editable mentions, improving safety and continuity when resuming or undoing terminal work.

- Rejects unsupported direct host and runtime API access before any Code Mode tool call can execute, while still allowing blocked API names when they appear only as inert tool data.
- Restores canonical CLI file references as editable `@` mentions during undo and draft restoration, preserves their action paths on resubmission, and handles cursor movement and deletion atomically.
- Requires no migration or configuration changes.
- Validated with 1,064 automated tests, TypeScript type checking, and the production build.

## 1.2.6 — Canonical mentions and clearer Code Mode boundaries

TideCode 1.2.6 standardizes how composer references are sent to agents and makes the restricted Code Mode runtime more explicit, reducing ambiguity between mention metadata and callable tool APIs.

- Uses `read_file:` for file mentions, `list:` for folder mentions, and `load_skill:` for skill mentions consistently across desktop and CLI.
- Removes legacy mention fallback formats such as `read:`, `skill:`, `folder:`, bare action tags, and the older resolved mention markup; previously stored messages using those removed forms are no longer interpreted as active mentions.
- Expands the Code Mode contract with an explicit list of unavailable direct host and Node.js APIs, including filesystem, process, networking, worker, and dynamic module access, and directs agents to the documented `tools.*` APIs.
- Validated with 1,059 automated tests, TypeScript type checking, and the production build.

## 1.2.5 - Smoother CLI and safer workspace tools

TideCode 1.2.5 makes terminal workflows and workspace tooling more predictable, with cleaner live output, faster local Git navigation, safer Code Mode execution, and more consistent workspace memory access.

- Improves CLI live rendering across terminal resizes, trims older transient output without placeholder noise, and lets Enter accept the highlighted `@` mention before submitting the message.
- Routes workspace memory reads through the standard read tool while keeping durable-memory mutations isolated to memory actions, with clearer handling for missing or invalid managed paths.
- Tightens Code Mode to tool-only host access and more reliably repairs malformed mutation arguments before execution.
- Makes Git branch switching local-first and nonblocking, recognizes known remote-only branches without network access, and reduces refresh contention during branch changes.
- Validated with 1,039 automated tests, TypeScript type checking, and the production build.

## 1.2.4 — Shared live work across desktop and CLI

TideCode 1.2.4 makes desktop and terminal chats behave like one shared live session, with durable handoff between clients and more natural editing and navigation in the CLI.

- Shares active AI runs through a local TideCode run service so reasoning, tools, streamed text, running state, cancellation, and final history stay synchronized between desktop and CLI even when the initiating client closes or reconnects.
- Keeps conversation edits and resends synchronized across clients, and upgrades CLI `/undo` into a non-destructive, checkpoint-aware edit mode with previous-turn navigation, visible history targeting, automatic viewport following, reliable Esc exit, and workspace rollback only when the edited turn is submitted.
- Aligns CLI `@` mentions with desktop behavior for files, folders, and enabled skills, including workspace ignore rules and canonical mention expansion, while improving waiting/thinking feedback and spacing between reasoning phases.
- Hides cancellation-only Code Mode failure blocks, preserves genuine Code Mode errors, and keeps existing saved conversations compatible without a migration.

## 1.2.3 — A more capable TideCode CLI

TideCode 1.2.3 makes the bundled CLI easier to configure, resume, and use for multimodal work while keeping desktop and terminal settings aligned.

- Adds richer CLI model and provider setup, including secure one-time API-key handoff into desktop Settings without exposing secrets in process arguments or saved command history.
- Adds clipboard and file image attachments in the terminal, preserves image references in conversation history, and falls back cleanly for models that do not accept image input.
- Improves terminal composition, multiline and bracketed paste handling, cancellation, resize rendering, reasoning history, and project-scoped active or archived conversation resume flows.
- Keeps CLI, desktop, MCP, and update version reporting aligned with the packaged application version and adds regression coverage for the new workflows.

## 1.2.2 — A smoother desktop and terminal workspace

TideCode 1.2.2 keeps the desktop workspace responsive while making the bundled terminal experience safer to launch and continue.

- Stops recursive workspace and source-control watchers from exhausting Windows handles and memory while keeping Explorer updates realtime for the workspace root and expanded folders.
- Skips inaccessible operating-system-managed directories during refactor-candidate discovery instead of repeatedly failing the workspace handler.
- Ships the bundled CLI runtime and launcher fixes, including safer empty-input handling and stable terminal history and spacing across packaged installs.

## 1.2.1 — Reliable bundled CLI launching

TideCode 1.2.1 fixes the installed terminal launcher so the `tidecode` command starts the bundled CLI correctly after installation.

- Resolves the packaged Electron executable and `app.asar` CLI entrypoint from the installer’s `resources/bin` directory on Windows.
- Supports the corresponding packaged Linux and macOS layouts while preserving source-checkout fallbacks for development.
- Adds regression coverage for the installed launcher paths so future packaging changes do not point users at unavailable source files.

## 1.2.0 — A synchronized terminal workspace

TideCode 1.2.0 brings the desktop chat experience into the terminal with shared history, settings, tools, and a more reliable workspace workflow across both interfaces.

- Adds a bundled interactive CLI/TUI with desktop-compatible conversation history, exact resume ordering, active and archived chat pagination, multiline composition, mentions, headless prompts, and responsive Esc cancellation.
- Adds `/settings`, `/model`, `/effort`, `/mcp`, `/skills`, and `/update`, including shared model defaults, queue/steer key preferences, MCP and skill toggles, configured-provider filtering, and packaged-app update handoff.
- Matches desktop tool and reasoning presentation in the terminal with concise completed tool rows, semantic success/failure colors, single-row thinking indicators, context usage, Codex week usage, model, mode, and effort status.
- Improves long-running terminal commands with bounded output collection, session state and status reporting, recent output context, interaction guidance, and reliable cancellation without replaying consumed output.
- Improves workspace previews, source-control publishing, Windows file drops, provider environment-key configuration, reasoning-effort presentation, and bundled CLI installation through the desktop installer.
- Includes regression coverage for CLI history synchronization, TUI rendering and controls, terminal execution, workspace publishing, previews, provider behavior, and update handling.

## 1.1.11 — Safer compaction handoffs and history persistence

TideCode 1.1.11 keeps long-running chats grounded after repeated context compaction, overlapping runs, and provider history reconstruction, while making streamed Markdown output safer and easier to continue.

- Preserves exact historical user prompts and verified handoff facts across compaction barriers, so earlier intent and unfinished work remain available without replaying raw tool calls or results to the provider.
- Protects newer compaction state from stale run completions and serializes concurrent history-file updates, including recovery from transient Windows file locks.
- Keeps legacy compressed histories readable, converts their handoff into safe provider context, and retains the original conversation display without requiring a migration.
- Hardens streamed Markdown and chat HTML handling by avoiding accidental fence repair inside quoted prompts and rejecting interactive input controls.
- Simplifies context settings by keeping the compaction retention budget internally bounded rather than exposing a separate retention-token selector.

## 1.1.10 — More accurate conversation continuity

TideCode 1.1.10 keeps recent chat work understandable after compaction, provider changes, and interrupted follow-up turns, while making visual workspace previews easier to inspect.

- Retains a configurable recent token window with complete user messages and images, bounded tool evidence, Code Mode completion receipts, and final assistant results from large turns.
- Preserves completed assistant replay state when an aborted follow-up creates a new history branch, preventing finished work from reverting to an earlier pre-response state.
- Keeps compaction decisions aligned with the context indicator and offers 4k, 8k, 10k, 12k, 16k, and 20k recent-token settings.
- Improves Markdown image preview sizing while preserving aspect ratio, alongside the existing PDF and DOCX preview controls.
- Adds regression coverage for rollback replay continuity, semantic retention, Code Mode compaction evidence, and context budgeting.

## 1.1.9 — Safer Code Mode and more faithful workspace previews

TideCode 1.1.9 strengthens Code Mode’s execution boundaries, keeps long conversations coherent through compaction and provider changes, and makes workspace previews easier to inspect.

- Strengthens the default Code Mode sandbox with workspace-scoped file permissions and explicit blocking for host process, network, and nested-worker access, while preserving a deliberate full-runtime mode when selected.
- Keeps complete tool results, compaction thresholds, retained turns, replay projections, and cross-provider history aligned so ongoing work is less likely to lose context or trigger an immediate repeat compaction.
- Improves activity presentation and terminal completion output, including clearer completed Code Mode results and more useful long-running command output.
- Makes local Markdown images resolve safely from the workspace and improves image, PDF, and DOCX preview sizing and controls for more comfortable inspection.
- Adds regression coverage across sandbox enforcement, compaction and replay, corrupted auth storage, tool presentation, preview sizing, and Markdown rendering.

## 1.1.8 — More reliable long-running work and clearer code review

TideCode 1.1.8 keeps extended agent sessions coherent while making generated code and workspace changes easier to read and review.

- Retains complete recent conversation turns and matching tool results during automatic and repeated compaction, with safer replay and recovery for interrupted or older history.
- Preserves long-running terminal output and tightens workspace tool contracts so agents can continue working without losing context or receiving ambiguous results.
- Lets users edit or revert steering messages from chat history and renders code blocks and diffs with consistent Monaco highlighting, line numbers, and theme behavior.
- Includes regression coverage for compaction boundaries, replay integrity, tool output handling, steering history actions, and code previews.

## 1.1.7 — More faithful tool context and inspectable workspace results

TideCode 1.1.7 keeps agent work grounded in complete tool context while making large workspace results easier to inspect progressively and Code Mode behavior more predictable.

- Preserves complete model-facing tool results through replay, provider migration, and compaction while keeping the visible activity stream concise.
- Adds consistent pagination metadata for workspace listing, file discovery, grep, and directory reads, with an explicit opt-in path for reading a complete text file.
- Aligns Code Mode tool discovery and prompt contracts, improves malformed-program recovery, and keeps context compaction aligned with the percentage shown in the UI.
- Expands regression coverage for oversized tool results, pagination, full-file reads, Code Mode discovery, and context budgeting.

## 1.1.6 — More capable Codex orchestration and dependable project work

TideCode 1.1.6 gives agent-mode work a safer orchestration layer, clearer file-operation feedback, and more reliable continuity when conversations, providers, or large tool results change over time.

- Adds Code Mode with validated tool discovery, bounded outputs, safe asynchronous execution, and concise model-facing tool contracts for coordinated workspace work.
- Makes file edits structured and reviewable with multi-hunk operations, read-range awareness, authoritative line bounds, ambiguity guidance, and atomic application.
- Preserves chat continuity across provider switches and replay, improves compaction budgeting, and presents nested tool activity, mentions, and recovery paths more clearly.
- Includes regression coverage for Code Mode, tool output limits, provider migration, prompt contracts, workspace editing, and long-running chat workflows.

## 1.1.5 — More natural follow-up steering and safer workspace paths

TideCode 1.1.5 keeps follow-up instructions in the active chat turn after tools finish and gives clearer guidance when workspace paths are malformed, so long-running work is easier to redirect without losing conversation continuity.

- Delivers queued steer-mode messages at completed tool boundaries without starting a separate model run.
- Preserves steer messages through streamed display, canonical replay, history persistence, rollback, and retry races.
- Normalizes workspace roots across chat tools and memory operations, with actionable errors for duplicated workspace-root paths.
- Adds regression coverage for steering batches, queue behavior, conversation history, and workspace path safety.

## 1.1.4 — Smoother chat continuity and workspace feedback

TideCode 1.1.4 keeps long-running work easier to follow and safer to resume, with more reliable continuation state, interactive terminals, responsive diff views, and faster workspace feedback.

- Reconciles compaction state against newer evidence so completed work does not reappear as an unfinished action after a long conversation is resumed.
- Lets agents respond to terminal confirmation prompts with literal text or control keys while keeping command progress asynchronous and explicit.
- Improves chat and reasoning auto-follow behavior, Monaco diff prewarming and model reuse, Git status loading, and compaction-marker loading across changing workspaces.
- Preserves visible dependency-directory boundaries in the workspace explorer and safely removes empty managed memory folders without deleting folders that still contain entries.
- Adds regression coverage for continuation reconciliation, terminal interaction, scrolling, diff caching, workspace watching, memory cleanup, and cached workspace metadata.

## 1.1.3 — A richer workspace editor and visual chat context

TideCode 1.1.3 makes project work easier to inspect and edit in place, while letting conversations use images as structured context and keeping update progress clear during downloads.

- Replaces workspace text and diff views with Monaco-based editing, search and replace, syntax-aware highlighting, Git line indicators, responsive diffs, and copy actions.
- Adds safe image workflows for clipboard paste, inline chat references, image attachments, and images read from the workspace, with bounded media handling and binary-safe compaction.
- Improves workspace explorer transfers, previews, virtualization, and cache behavior so large or changing projects remain responsive.
- Keeps Settings aligned with the release version actually being downloaded and preserves download progress across update checks.

## 1.1.2 — Durable workspace memory and dependable long-running terminals

TideCode 1.1.2 gives agents a secure, workspace-scoped place to retain durable project context and makes long-running terminal work easier to follow and control.

- Adds managed Markdown memory entries with generated indexes, native agent and plan-mode access, checkpoint integration, and path/symlink safety checks.
- Starts terminal commands asynchronously, preserves output across bounded polling reads, reports completion and failures clearly, and supports explicit session termination.
- Updates prompts, tool activity presentation, and regression coverage for durable memory, terminal sessions, and related chat workflows.

## 1.1.1 — Clearer web search results and Source Control polish

TideCode 1.1.1 makes web-search results easier to scan and keeps the same readable presentation when conversations are restored, while adding a small visual cue to the collapsed Source Control history area.

- Renders web-search actions and validated source links as readable Markdown instead of exposing provider response objects.
- Preserves clickable citations across live results, replayed conversations, and Responses-style provider payloads while rejecting unsafe or malformed URLs.
- Adds a visible divider when Source Control history is collapsed and includes regression coverage for web-search parsing, replay normalization, and rendering.

## 1.1.0 — Smarter MCP tools and steadier chat workflows

TideCode 1.1 makes connected tools easier to discover and keeps everyday chat editing, interruption, and workspace feedback dependable as work changes quickly.

- Adds a searchable MCP tool catalog with natural-language matching, stable tool IDs, opt-in input schemas, and exact execution for connected servers while honoring per-server permissions.
- Keeps send, edit, stop, revert, and queued follow-up actions synchronized when responses are still starting or stopping, preserving pending drafts and persisted conversation state safely.
- Improves Markdown ordered-list rendering and diff gutters, and makes tool activity, empty directories, and archived-thread deletion confirmation clearer.
- Keeps existing MCP server configurations compatible while exposing only enabled and allowed tools, with regression coverage across MCP search and execution, chat cancellation and editing, list rendering, and tool presentation.

## 1.0.33 — Reviewable plans and more reliable chat workflows

TideCode makes plan-driven work easier to review while keeping long-running chat, terminal commands, and workspace state reliable during interruptions and rapid changes.

- Adds persisted plan comments, revisions, implementation handoff, and visible plan status transitions in the workspace.
- Improves workspace explorer synchronization, selection, transfers, undo behavior, file previews, and tabs as files change.
- Expands provider model metadata and output-token limits while improving API-key runtime handling and model settings controls.
- Preserves streamed assistant output and aborted tool results correctly, keeps terminal output available across bounded reads, and handles interactive terminal prompts more reliably.
- Includes regression coverage for plan workflows, workspace behavior, provider limits, chat cancellation, terminal sessions, and tool interactions.

## 1.0.32 — Reviewable plans and live workspace state

TideCode now turns Plan mode into a reviewable workspace artifact while keeping Source Control and MCP integrations accurate as the workspace changes around it.

- Creates incrementing `.tidecode/plans/plan-###.md` files from Plan mode, opens the rendered plan preview automatically, and supports updating a plan after review feedback without editing source files.
- Adds plan review actions for comments, requesting changes, implementing a plan, and showing the persisted implementation-started state; chat history and revert/redo keep plan files and chat mode aligned.
- Refreshes Source Control when external Git commits, branches, or workspace edits change, while preserving subscriber cleanup and focused updates for open panels.
- Gives MCP servers stable, collision-safe tool namespaces and clearer server context so similarly named tools remain distinguishable.
- Fixes Markdown preview handling for inline HTML examples and ordered-list markers so plan content stays laid out and colored as intended.

## 1.0.31 — Delete archived chats and clearer upgrade progress

TideCode now lets you permanently remove an archived thread, and Settings shows the version that is actually downloading instead of the one you are currently running.

- Adds a permanent-delete action to archived threads in the sidebar, behind an explicit confirmation dialog, so removing an archived chat can no longer be triggered by mistake.
- Shows the downloading version in the update status while a release downloads or is ready to install, so the heading matches what is about to be installed rather than the version already running.
- Preserves safe deletion by canceling any in-flight task on the thread first and guarding against deleting a thread while its task is initializing.

## 1.0.30 — More useful terminal work and clearer feedback

TideCode now gives the agent a focused terminal workflow while keeping command progress and operational problems readable for people using the app.

- Separates starting commands, reading bounded output ranges, and interacting with running sessions so large terminal results do not flood the conversation.
- Detects confirmation, password, Enter, key-driven, and interactive-screen prompts, then exposes the clean visible terminal screen or the appropriate input controls.
- Keeps terminal cards user-facing by hiding session identifiers and internal metadata while preserving useful command status and output counts.
- Improves plain-language error feedback across terminal, workspace, settings, source-control, and update flows.
- Preserves workspace sandboxing, shell completion detection, session cleanup, and regression coverage for the updated behavior.

## 1.0.28 — More dependable Source Control updates

TideCode now keeps Source Control accurate while commits and workspace edits happen both inside and outside the app.

- Refreshes commit history automatically while the Source Control panel is open, including an immediate refresh when the app becomes visible again, without polling hidden panels.
- Shows top-level modified files as modified instead of incorrectly marking them as deleted.
- Keeps the workspace edit tool focused on one replacement operation at a time and adds regression coverage for the updated Source Control and editing behavior.

## 1.0.27 — More reliable long conversations and workspace changes

TideCode now keeps long-running AI conversations more coherent through compaction and reduces noisy workspace updates while editing.

- Preserves provider-aware reasoning continuity and generates ordinary Markdown continuation context when conversations compact, including safe fallback and repeated-compaction replay.
- Keeps assistant and tool history, context usage, compaction markers, queued sends, and model switching aligned after compaction and replay.
- Filters editor temporary files, deletion markers, and ignored directories from workspace watch updates without hiding ordinary build output, while normalizing workspace roots across Windows path casing and separators.
- Makes text replacement more tolerant of indentation and terminal newline differences while keeping ambiguous edits and stale content protected.
- Includes regression coverage for compaction lineage, reasoning retention, edit matching, and workspace watch behavior.

## 1.0.26 — More trustworthy conversation history

TideCode now saves conversation history more reliably and keeps stop, revert, and source-control actions from leaving stale or conflicting state behind.

- Serializes per-conversation history writes with a retrying atomic writer, so overlapping streaming snapshots no longer lose the newest message and Windows file-lock errors are retried instead of failing the save.
- Stops a reverted user turn from continuing to run in the background and re-inserting itself into history when stop or revert lands during the pre-stream window, and restores the composer draft more consistently.
- Keeps the context indicator and compaction markers and status accurate while switching conversations, streaming, and compacting.
- Discarding an unstaged file restores only the worktree diff, avoids a stale diff cache, and surfaces file-action errors; file-heavy actions also pause the commit action until they finish.
- Cleans up draft context for an abandoned chat only after that conversation is deleted, avoiding a race that could affect an unrelated conversation.
- Includes regression coverage for history persistence, streaming progress, stop and revert, compaction, and source-control discard.

## 1.0.25 — More reliable fast chat switching

TideCode now keeps chat sends anchored to the conversation and project currently shown, even when a new thread or workspace selection changes immediately before sending.

- Prevents fast sends from targeting a previously active running conversation after creating or switching threads.
- Keeps selected project context aligned across new-message, programmatic, and edit sends.
- Makes code block headers more compact while preserving the existing presentation.
- Includes regression coverage for draft and persisted-thread selection changes.

## 1.0.24 — Smoother workspace editing and clearer controls

TideCode makes workspace editing more predictable while making model and chat controls easier to read and use.

- Preserves editor selections across focus changes, typing, tab switches, and middle-click file navigation.
- Improves workspace tab interactions and keeps diff content aligned with the editor presentation.
- Orders reasoning effort choices consistently and improves selected-state contrast across model and chat dropdowns.
- Refreshes provider model catalogs and includes regression coverage for the updated workspace and reasoning behavior.

## 1.0.23 — More reliable compacted conversations

TideCode now preserves the complete active conversation after compaction and gives clearer feedback while terminal output is still being retrieved.

- Retains assistant and tool responses from turns that occur after a compaction anchor during canonical replay.
- Shows Waiting for terminal while terminal output reads are still running instead of implying that a file read is occurring.
- Adds regression coverage for compacted replay suffixes and retained tool results.

## 1.0.22 — Safer workspace discovery and steadier chat

TideCode now keeps AI workspace discovery focused while preserving explicit access to known paths, and improves reliability across long-running conversations and workspace navigation.

- Hides .gitignore entries, generated files, and common developer directories from default AI list, glob, grep, and @mention discovery.
- Allows explicitly targeted ignored directories to be listed, searched, and traversed recursively without exposing them during broad discovery.
- Strengthens chat stream integrity, context accounting, compaction recovery, queued sending, workspace tabs, and related failure handling.
- Adds regression coverage for ignored-path access, generated-file filtering, runtime streaming, context usage, and workspace explorer behavior.

## 1.0.21 — More dependable context compaction

TideCode now keeps long conversations moving through context compaction with clearer progress feedback and a strict safety gate before the next model step continues.

- Shows when compaction starts, completes, is unavailable, or is interrupted directly in the conversation.
- Uses the same token accounting for automatic compaction and the context usage indicator, while preserving safe tool-call boundaries.
- Prevents an over-limit conversation from continuing unless compaction produces a valid below-threshold history projection, with regression coverage for lifecycle and failure paths.

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
