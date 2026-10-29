# Durable project knowledge

- On 2026-10-27 the user required provider-agnostic context accounting and compaction, including custom providers, requested a detailed plan file, and then approved implementing it. Keep shared scheduling/retention independent of provider counting and cache capabilities. The implementation contract and verification record are in `docs/plans/provider-agnostic-context-compaction.md`.

- On 2026-10-27 the user explicitly approved separating navigation into `browser.navigate` and removing it from `browser.interact` including sequences. Keep browser tool result display structured plain text at the producer, with no fallback conversion and screenshots outside the text-scrolling area.

- Latest browser policy, approved 2026-10-26: AI-owned tabs have full control and AI-selected viewport resolution (default 1440×900); user-owned tabs are strictly read-only at their actual screen resolution, with no focus, scroll or resize side effects. Keep identical tab styling with ownership labels, scale preview to fit without cropping or stretching, animate a context-aware virtual pointer in correct viewport coordinates before tool completion, and show Markdown per-action reports with actual target coordinates. Never move the Windows pointer or automatically retry uncertain browser input.

- On 2026-10-26 the user approved stronger AI editing with the explicit constraint that AI instructions must stay lean. Prefer accurate runtime diagnostics and targeted evidence over adding repetitive prompt instructions.



- On 2026-10-25 the user required AI browser automation to use its own background Chromium surface and virtual cursor without moving the user's OS pointer, stealing focus, switching the user's active tab, or temporarily resizing the user's browser panel. The AI cursor should map to the actual AI screenshot at any preview size and viewport resolution. Do not allow ordinary AI input to interfere with visible user browsing.

- On 2026-10-24 the user clarified that Browser's Open in main panel action must free the shared side-panel area for Explorer and other tools to open independently beside Browser. It must be separate from fullscreen.

- On 2026-10-23 the user reverted the independent right-docked Terminal request: it should replace Browser, Diff, Source Control and Explorer in the shared right-panel area and use their shared width. Keep the Move panel right/bottom action at the far right of the terminal header.

- Browser zoom controls should remain in the Browser menu and also appear in a floating panel when zoom changes. The user requested a faster auto-dismiss; the panel uses 1.5 seconds and pauses during hover/focus. Browser and New tab menus should dismiss when clicking outside, including into the embedded webpage.

- On 2026-10-22 the user explicitly required AI-started terminal commands, including long-running servers and their child processes, to terminate when their chat turn ends and when the app closes. Do not treat those commands as persistent background work across turns or desktop closure.

- The user wants all user-visible errors to explain the actual known cause in plain language, with titles tied to the operation. Centralize editable error copy in one catalog. Do not replace known duplicate-folder causes with generic errors. Transient error toasts disappear after three seconds; persistent in-panel errors remain until resolved or dismissed.

- On 2026-10-21 the user confirmed that shared workspace MEMORY.md remains instruction-driven through ordinary file tools. Inject only instructions to read the index and relevant details, never index contents; disabled memory injects nothing. Details use name/description frontmatter followed by expanded knowledge. Descriptions must be short, specific, and useful for selecting what to read. TideCode generates the index and updates it immediately after normal AI file-tool changes. The user also requires efficient realtime indexing: avoid full detail-body reads and unrelated scans, keep caches bounded, and measure performance without weakening immediate consistency.

- On 2026-10-21 the user confirmed that edit and patch must continue to run through exec and approved deterministic recovery of misplaced string payloads, exact bare bindings, and unique case/underscore/hyphen naming mismatches. Preserve source validation and reject conflicting or ambiguous interpretations rather than guessing unrelated names.

- On 2026-10-21 the user requested editable Markdown sources for injected user-role instructions, separate from system prompt files. Keep dynamically generated compaction, tool results, and actual runtime values in code rather than migrating them to Markdown.

- On 2026-10-21 the user requested no em dashes in responses. The response prompt applies this rule to prose and generated UI text.

- Reverted-message submission must invalidate discarded compaction dividers at the same time as later messages. Waiting for the response to finish leaves same-anchor dividers beside new output; older in-flight marker loads must not restore them. Verify with the real stale marker list, including multiple compactions anchored to the edited user message.

- On 2026-10-21 the user clarified that Revert should keep later messages visible while the selected message is edited and its checkpoint restored. Keep the active context at the reverted point, preserve the placement of compaction dividers alongside visible history, and replace the later branch only when the edited message is submitted.

- On 2026-10-21 the user approved user-first compaction retention: keep the latest actual request intact, protect bounded earlier user intent before large assistant explanations, preserve grounded progress and remaining obligations in the handoff, and count all runtime context in the retention budget. Earlier requests remain historical; do not reopen completed work or infer fresh approval merely because their wording survives. Preserve continuity across repeated compactions without a growing numbered prompt ledger.

- Compaction UI regression (2026-10-21): replacing a live boundary with a saved marker must keep previous tools finalized in the same work timeline. A streaming draft may predate compaction and is not a safe fallback position for the marker. Verify both closed and manually opened groups across marker loading and resumed output; newly active tools must still appear normally.

- On 2026-10-21 the user approved proactive generative UI in AI responses while retaining Markdown. Prefer native TideUI for useful structured comparisons, options, timelines, metrics, progress and interactions without requiring an explicit visual request. Keep explanations, code, commands and short answers in Markdown, combine formats without duplication, and use custom HTML when its layout or local interaction capabilities add value beyond native components. Avoid decorative interfaces and fabricated data or functionality.
- On 2026-10-21 the user clarified that AI-authored visual customization must take priority when explicitly specified, in native TideUI as well as custom HTML. When no styling is specified, use TideCode defaults. Reuse native dialog patterns for generated modals and retain sandboxing for embedded custom HTML.

- On 2026-10-20 the user explicitly asked for every application error to follow the browser screenshot toast's visual language and use plain, actionable wording rather than technical exception text. Preserve technical output in tool/terminal diagnostics where it is useful, not in ordinary user notifications.

- On 2026-10-20 the user clarified that branching should copy the chat through the selected point, including applicable compression and durable memory. Reverting after several compactions should reuse the latest safe earlier compaction and retained messages instead of loading the raw transcript from the first message. Preserve separate per-chat ownership after branching. Tests may use isolated copies of chat `22fa05ff-8b2a-47b9-ae29-dd346763c9be`; do not rewrite its live saved history for verification.

- The user prefers a concise but firm AGENTS.md injection: require reading the full file, designate it as authoritative workspace instructions, and require following every applicable requirement and exception. Avoid a long explanation of individual requirements.

- On 2026-10-21 the user clarified that the authoritative-workspace-instructions designation belongs in the conditional hidden user context, not in the system prompt. Keep it concise and scoped to the detected root AGENTS.md; leave the system prompt and global mindset.md unchanged.

- The user explicitly clarified that stronger AGENTS.md guidance must be scoped to the conditional workspace instruction injection, supplied only when AGENTS.md exists in the workspace. Do not change the global mindset.md prompt for this purpose.

- On 2026-10-20 the user clarified that compaction and durable memory should let the same chat keep going reliably, including when the token threshold is reached during active work. Preserve relevant facts and unfinished obligations through consolidation; do not accumulate numbered prompt histories or claim completion from assistant responses, keywords, or the compaction boundary. Durable memory carries lasting knowledge; compression carries the current working state.

- For durable-memory creation versus reconciliation, the user explicitly prefers separate complete Markdown instruction files selected by the host, so each API call receives only its scenario's instructions. Do not combine both scenarios in one instruction file sent on every call.

- On 2026-10-20 the user approved replacing Code Mode's custom interpreter with isolated native V8 execution so AI programs can use ordinary JavaScript without language-specific workarounds. Preserve registered-tool authority, discovery, validation, permissions and execution limits; do not retain the custom interpreter as a fallback.

- On 2026-10-20 the user requested native tool namespace guidance in TideCode's existing mode-transition hidden user context rather than the stable exec tool description. Plan Mode should receive planning-safe namespace guidance and a later Agent Mode implementation turn should receive Agent-native namespace guidance without inventing plan approval. Root tool discovery remains MCP-only, while native discovery requires an explicitly named namespace or exact contract lookup.

- On 2026-10-20 the user required AI-created browser tabs to be visible in TideCode's existing browser panel so they can watch and interact with the same live page. The user also approved replacing the single `native` discovery namespace with five descriptively named native groups (`native_browser`, `native_files`, `native_terminal`, `native_skills`, `native_plan`) while preserving callable tool paths. Connected MCP namespaces should display their own server descriptions when available, otherwise a neutral fallback; every listed tool retains a concise description.

- On 2026-10-20 the user approved TideCode-native visual browser automation using the embedded Electron Chromium engine, not an external Google Chrome installation. Use six Code Mode browser APIs (open/read/tabs/interact/terminate/devtools), combine 1280x720 screenshot + DOM/accessibility readings, prefer semantic element interactions, include page annotations tied to chat prompts, and make privileged raw CDP opt-in through Full Developer Mode. Preserve the browser's existing UI and theme.

- The user confirmed on 2026-10-18 that TideCode durable memory should be per chat, with Markdown stored inside each chat's existing history as the single source of truth, rather than a separate project DURABLE.md file. This storage choice is confirmed; implementation still requires approval of the concrete plan.

- For the RAM/CPU optimization work discussed on 2026-10-17, the user prefers improving the current Electron app first. Rust is an option to evaluate against measured remaining bottlenecks, not an approved migration.
- Resource/speed optimizations must retain existing UX and user state. The user specifically wants desktop Send to display the bubble immediately; preserve editing, queues, cancellation, attachments and navigation when making presentation optimistic.
- Distinguish current checkout behavior, installed application measurements, and historical profiling reports. Do not attribute installed-process resource use to a source change without establishing artifact parity.

- For the sidebar project selector, preserve two-row project items and let row highlighting follow hover. On desktop, reveal the ellipsis action on row hover; give its icon its own scale/color hover feedback and tooltip to the right of the icon, above the dropdown menus, without a button background. Hovering the icon also highlights its project row without selecting it. The Rename/remove actions menu opens at the icon's click position, like the Explorer context menu, and stays inside the viewport; close the tooltip while that menu is open. Do not show checkmarks in the project dropdown. Choosing a project should immediately filter history to it and retain that filter while its new conversation is created. On 2026-10-24 the user moved Chats into the main project dropdown and requested its automatically resolved absolute agent-contexts directory beneath the title, rather than a literal placeholder or home-relative path. Chats has no project rename/remove actions.

- Opening/reopening Diff must show its known changed-file list immediately; refresh metadata and hydrate previews without clearing the list while full file contents load. The user approved matching Diff panel file rows to Source Control: compact 49-pixel rows, file-type icons, semantic status letters instead of inline +/− counts, deleted-name strikethrough, subtle separators, hover backgrounds and right-aligned actions. Keep expansion/previews and Git actions, and leave inline chat diffs unchanged.

- Diff file headers should already occupy their final positions before clicking: preserve filename/status/control alignment across collapsed, loading and expanded states, while retaining on-demand heavy preview rendering.

- The user wants Browser to open as a right sidebar with optional workspace fullscreen, replacing other right-side panels when selected. Browser's new-tab control and Diff's fullscreen control should match the terminal controls and use the shared Tooltip. Panel resizing must stop before chat contents overlap and must keep the layout stable during drag and release.

- Browser controls keep new-tab and fullscreen buttons outside the vertical three-dot menu. The camera is named Screenshot, belongs at the right end of the URL row, and stays disabled while the initial page is blank, enables once the document is ready, and works before the webpage finishes loading. It automatically saves the visible webpage PNG into the user home `~/.tidecode/browser-screenshots/` folder with `browser-screenshot-<hostname-with-hyphens>-<base36-timestamp>-<8-hex>.png` names. Success uses a Screenshot saved toast at the top of the browser below the URL row, using light/dark theme colors and compact responsive spacing with no checkmark icon, with Copy path, Reveal in File Explorer, and Copy image actions rather than changing the camera icon. Copy actions briefly change their button labels to Copied path/Copied image and then revert on independent timers; Reveal in File Explorer adds no success text. The menu contains floating-only DevTools, page zoom, and cookie/cache clearing, with no profile label or DevTools icon. Hide Open DevTools and zoom on new tabs, but enable it immediately when website navigation begins, including redirects. The divider before new-tab must not double up against overflowing tab borders.

- The Browser + control opens a dropdown with New tab and New incognito tab. Incognito must avoid persisted browsing history/site data, stay separate from normal sessions, and clear private storage after the last private tab closes. The user approved disabling the automatic screenshot saver in incognito so private browsing does not create screenshot files.

- The user explicitly requested no smooth scrolling on 2026-10-20. Chat autoscroll should follow immediately and consistently for normal text, TideUI and reasoning; address flashing through rendering stability rather than eased or animated scroll movement.

- The user clarified on 2026-10-20 that generated panels must fill progressively, including individual parts of charts/graphs and other widgets. Do not wait for a whole panel, chart or other native widget to finish before rendering its completed parts. Retain existing component instances as more parts arrive.

- The user requested broadly tolerant TideUI presentation syntax on 2026-10-20, rather than repeatedly adding one-off fixes for entry names or parent contexts. Normalize safe presentation by context and preserve valid content when a declaration is malformed; retain capability and URL validation.

- The user clarified on 2026-10-20 that HTML should embed visually directly into chat: no outer preview card/border/toolbar, visible viewer title, manual resizing or Expand control. The latest clarification requires actual content height with no fixed height or height cap. Scrolling over HTML must respect upward user intent rather than snapping chat back to the bottom. Keep wheel movement and momentum native, matching scrolling outside HTML; do not intercept wheel input and apply scrollTop deltas manually. Retain the generated design and iframe isolation.

- On 2026-10-20 the user approved unifying custom HTML under `tidehtml`: CSS and JavaScript are independently optional, completed blocks execute automatically (including saved-message remount). Keep the existing sandbox and click-required TideCode action bridge.

- Describe the supported custom HTML format directly in AI instructions. Do not mention nonexistent format names, including in prohibitions or migration guidance.

- Keep Markdown instructions and feature documentation limited to the current supported behavior. Remove obsolete rules and migration commentary instead of retaining them as historical instructions.

- Generated UI action buttons should keep their labels unchanged and omit routine progress/success messages after clicks. Retain pending/duplicate-send protection and show actionable failures only.

- On 2026-10-22 the user requested a concise write tool contract with specific, firm requirements for human-readable source: consistent indentation, expanded blocks, separate statements and structural elements, and the same readability for embedded languages. Keep its basic operation, exact-content transport and read-back verification. Do not restore the lengthy formatting checklist or examples without a new request. They declined a TideCode-managed formatter; readable output must not depend on a project formatter being installed.
- Keep source-formatting guidance in the relevant tool contracts rather than reintroducing a global formatting prompt.
- The user explicitly requires retrieved tool instructions to be authoritative for using their tools. Do not classify those contracts as ordinary untrusted tool output; their usage requirements apply within higher-priority instructions and current permissions.

- Browser automation must open/select a tab once and use its tab_id for screenshots, reads and non-navigation interactions. The user expects current live tab state to persist, without repeated URL input, reloads or replacement tabs. Browser reliability work must distinguish reproduced causes from hypotheses about historical timeouts.
