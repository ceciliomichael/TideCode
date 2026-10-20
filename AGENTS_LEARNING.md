# Durable project knowledge

- On 2026-10-21 the user approved proactive generative UI in AI responses while retaining Markdown. Prefer native TideUI for useful structured comparisons, options, timelines, metrics, progress and interactions without requiring an explicit visual request. Keep explanations, code, commands and short answers in Markdown, combine formats without duplication, and use custom HTML when its layout or local interaction capabilities add value beyond native components. Avoid decorative interfaces and fabricated data or functionality.

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

- For the sidebar project selector, preserve two-row project items, let hover highlighting follow the pointer, and keep the ellipsis action's hover separate from the project row. Do not show checkmarks in the project dropdown. Choosing a project should immediately filter history to it and retain that filter while its new conversation is created. Keep Chats in the history filter, not the project dropdown.

- Opening/reopening Diff must show its known changed-file list immediately; refresh metadata and hydrate previews without clearing the list while full file contents load. This includes accurate Staged/Unstaged +/− counts alongside file names; do not defer counts until preview contents arrive.

- Diff file headers should already occupy their final positions before clicking: preserve filename/count/control alignment across collapsed, loading and expanded states, while retaining on-demand heavy preview rendering.

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

- For generated-source readability, the user wants language-agnostic AI instructions without code examples. They explicitly declined a TideCode-managed formatter and prefer improving the AI's adherence and source review; readable output must not depend on a project formatter being installed.
