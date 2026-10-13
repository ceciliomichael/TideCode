# Plan 090 - Application-Wide Light and Dark Color Consistency

**Status:** Implemented after user approval. Automated verification complete; manual screenshot/runtime visual review remains an explicit final validation step.
**Workspace:** C:\Users\Admin\Desktop\tidecode
**Branch inspected:** develop
**Scope:** All TideCode-owned desktop and remote web UI, with explicit coverage for every Settings screen, standalone dialog, and non-shared component.

## Goal

Make TideCode light mode internally consistent, make dark mode internally consistent, and ensure all app-owned surfaces use a common semantic color system. Preserve the existing neutral/graphite visual direction and restrained green TideCode branding. Do not redesign layouts, typography, control geometry, or interaction behavior under this plan.

Consistency means identical **roles**, not identical colors everywhere: canvas, sidebar, panels, raised surfaces, fields, selected states, hover states, text, borders, overlays, and semantic status colors must have a predictable hierarchy in both appearances.

## Inspection and evidence

This is a source-code audit and implementation design, **not** a visual certification. Source reading, directory inventory, and literal-color / Tailwind-class scans were performed. No application screenshot comparison, contrast calculation, build, or end-to-end UI run has yet been performed. Accordingly, findings below distinguish confirmed source discrepancies from areas needing visual validation.

Existing theme ownership:
- src/index.css declares app tokens in @theme and the dark overrides at :root[data-theme='dark']. It also contains many second-level component and editor CSS variables.
- src/hooks/useDocumentTheme.ts sets root data-theme, color-scheme, cached preference, favicon, and browser theme-color.
- src/hooks/useResolvedDocumentTheme.ts allows other React surfaces to observe theme changes.
- src/lib/theme.ts and index.html each contain prepaint/meta appearance colors.
- electron/window/theme.ts defines the native window palette independently.
- src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTheme.ts defines a large separate light/dark Monaco palette.
- src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils.ts independently defines ANSI and terminal UI colors.
- src/lib/codeHighlighting.ts and workspaceMonacoShiki.ts use GitHub Shiki syntax palettes.
- src/components/workspaceExplorer/workspaceMarkdownPreview/mermaid-utils.ts already reads some semantic CSS colors.
- electron/window/trayPopup.ts embeds separate HTML/CSS with light/dark palettes.
- electron/remote/webAuth.ts emits an independent, **dark-only** unauthenticated remote sign-in page, outside React and the usual Settings component tree.

### Confirmed source-level inconsistencies and priorities

| Priority | Evidence | Problem / intended resolution |
| --- | --- | --- |
| P0 | src/components/settings/remote/RemoteSettingsPanel.tsx:16 | A light brand-soft background is paired with text-white for primary Remote actions. Use an appropriate action surface and foreground pair with proven contrast in both themes, preferably the shared primary-action style. |
| P0 | src/components/settings/skills/SkillAddDialog.tsx:121 | Hover class bg-surface-hover refers to a color not declared in src/index.css. Replace with a defined semantic hover role; add a token-existence regression check. |
| P0 | electron/remote/webAuth.ts:26-34 | Remote sign-in is hardcoded dark. Support app-consistent light/dark styling with a prepaint choice from that web origin's saved appearance or system preference, without relying on authenticated APIs. Do not alter authentication handling. |
| P1 | src/components/settings/mcp/McpAddDialog.tsx:215, McpRemoveDialog.tsx:28; models/RemoveUserModelDialog.tsx:19, models/UserModelDialog.tsx:241; providers/CodexProviderDialog.tsx:54, ProviderConfigDialog.tsx:96; skills/SkillAddDialog.tsx:97; taskModels/TaskModelConfigurationDialog.tsx:79 | Independent modal backdrops use black/12, black/20, and black/60. Choose a documented backdrop role and test readability and layering in both themes. |
| P1 | src/components/settings/shared/statusPillStyles.ts:5-8 | Active/inactive status badges reuse segmented-control active/hover surfaces. Define selection and status semantics independently so the same status looks consistent across Settings. |
| P1 | src/components/settings/remote/RemoteSettingsPanel.tsx:14-16; updates/UpdatesSettingsPanel.tsx:235; shared/actionButtonStyles.ts | Primary actions vary between dark action fills, pale brand fills, and different foregrounds. Define named primary/secondary/soft-action treatments with correct text. |
| P1 | src/components/settings/providers/CodexAccountsList.tsx:51-73; models/ModelsSettingsPanel.tsx:184-218 | Card and field interiors alternate between bg-background, bg-surface, and bg-surface-muted. Audit their intended surface levels rather than replacing indiscriminately. |
| P1 | src/components/workspaceExplorer/workspaceMarkdownPreview/WorkspaceMarkdownPreviewView.tsx, workspacePlanPreview/WorkspacePlanPreview.tsx, workspaceSvgPreview/WorkspaceSvgPreviewView.tsx | Several warning/error banners use amber-50, amber-200, amber-700 without dark equivalents; convert to semantic warning surfaces/text/borders. |
| P1 | src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTheme.ts | Editor chrome, widgets, selection, gutter, and diff colors independently duplicate the app palette. Derive structural colors from documented theme roles while retaining code-specific syntax and diff semantics. |
| P1 | src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils.ts:109-169 | Light terminal assigns the same dark color to nearly every ANSI slot whereas dark distinguishes ANSI hues. Match terminal chrome to app tokens and retain readable ANSI semantics in both themes. |
| P1 | src/components/browser/BrowserPanel.tsx:693-706; src/main.tsx:13-21 | App-owned browser loading indicator is fixed white and the bootstrap error is fixed dark; use theme-aware roles. Do not recolor real websites. |
| P1 | electron/window/theme.ts:17-27; src/lib/theme.ts:7-8; index.html:7-38; electron/window/trayPopup.ts:46-60 | Shell/native/prepaint/tray colors are maintained separately. Align their actual values and update behavior; preserve OS-specific native requirements. |
| P2 | src/components/chat/ConversationDiffFileItem.tsx, DiffPanelToggle.tsx, ToolInvocationBlock.tsx; src/components/sourceControl/* | Success/additions and danger/deletions use different Tailwind emerald/red levels. Standardize Git and status roles without removing their meaning. |
| P2 | src/components/chat/ChatMentionMenu.tsx, ChatMentionText.tsx; src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerEntryRow.tsx | Mention-type and Explorer Git-status colors are directly encoded and may contrast differently in the two themes. Introduce semantic pairs where needed. |
| P2 | src/components/settings/mcp/McpServerCard.tsx:32-42; src/components/remote/RemoteAccessIndicator.tsx | Connection status dots use independently picked emerald/amber/red/neutral values. Map to common success/warning/danger/neutral roles. |

### Intentional exceptions, not bugs by themselves

- File-type icon palettes in src/lib/fileIconConfig.ts.
- Git graph lane colors if they remain distinguishable against both themes.
- Code syntax token colors in Shiki and Monaco, provided surrounding editor chrome matches TideCode and tokens remain legible.
- Terminal ANSI colors, which have meaning, but should have coordinated light/dark sets.
- Third-party website contents and Electron webviews; only TideCode-owned browser controls are in scope.
- Actual image pixels, SVG/PDF/DOCX page contents, and white document-paper surfaces where white is required to represent a document faithfully.
- Real brand colors (e.g. GitHub/GitLab) and intentionally meaningful danger/warning/success colors.
- Transparent selection overlays and scrims if they satisfy the named semantic role.

No mass replacement of every hexadecimal value or every dark: class is permitted. Each exception must be identified and justified.

## Complete Settings page coverage matrix

**Important:** Settings is not solely composed of reusable controls. Every row below includes the actual panel's **own** fields, cards, dialogs, portal backdrops, banners, and loading/empty states, even when it never renders shared UI primitives.

| Settings navigation / sub-surface | Files and presentation routes to inspect | Required checks |
| --- | --- | --- |
| General | general/GeneralSettingsPanel.tsx; general/GeneralSettingsSkeleton.tsx | Appearance, language, segment controls, dividers, skeleton, dark/light/system transitions. |
| Providers | providers/ProvidersSettingsPanel.tsx; ProviderCard.tsx; ProviderConfigDialog.tsx; CodexProviderDialog.tsx; CodexAccountDropdown.tsx; CodexAccountsList.tsx; CodexUsagePills.tsx; ProvidersSettingsSkeleton.tsx | Default/connected cards, Codex account selections, add/edit/remove flows, credentials fields, usage badges, primary/cancel/danger actions, independent modal backdrop, errors/loading. |
| Models | models/ModelsSettingsPanel.tsx; ModelsProviderSection.tsx; UserModelDialog.tsx; RemoveUserModelDialog.tsx; ModelsSettingsSkeleton.tsx | Search, enabled switches, provider headings, badges, editable model form, dropdowns, removal confirmation, loading/error/empty. Non-visual modelCatalog/modelStorage modules are not color owners. |
| MCP Servers | mcp/McpServersSettingsPanel.tsx; McpServerList.tsx; McpServerCard.tsx; McpAddDialog.tsx; McpRemoveDialog.tsx; McpServersSettingsSkeleton.tsx | Status dots, disconnected/connecting/connected/errors, expand/collapse tools, add/edit/remove forms, enable/disable buttons, separate modal scrim. |
| Skills | skills/SkillsSettingsPanel.tsx; SkillList.tsx; SkillCard.tsx; SkillAddDialog.tsx; SkillsSettingsSkeleton.tsx | Skill cards, editor fields, close hover, overlays, submit/cancel buttons, errors, skeleton and empty state. |
| Task Models | taskModels/TaskModelsSettingsPanel.tsx; TaskModelConfigurationCard.tsx; TaskModelConfigurationDialog.tsx; TaskModelsSettingsSkeleton.tsx; context/ContextSettingsPanel.tsx | Model configuration selectors, reasoning controls, compaction settings/range, selected cards, modal, loading, warnings. Context is embedded in Task Models rather than a separate nav item. |
| Updates | updates/UpdatesSettingsPanel.tsx | Update statuses, action button and release notes, download/available/error/idle progress states, settings toggles, disabled states. |
| Remote | remote/RemoteSettingsPanel.tsx; RemoteSettingsSkeleton.tsx | Network status, credentials and passwords, action styles, input backgrounds, success/error banners, copying addresses; desktop-only page. |
| Settings shell and reusable primitives | SettingsContent.tsx; SettingsSidebarPanel.tsx; SettingsPlaceholderPanel.tsx (currently not imported by another source file); shared/SettingsPanelPrimitives.tsx; SettingsSkeletonPrimitives.tsx; LineNumberedTextarea.tsx; actionButtonStyles.ts; statusPillStyles.ts; src/components/ui/DropdownField.tsx; SegmentedField.tsx; Switch.tsx; src/components/Tooltip.tsx | Sidebar active/hover selection, cards/rows/section headers, custom component and ad-hoc field equivalence, placeholders, disabled states, portaled surfaces. Exclude unmounted placeholder from runtime acceptance until mounted. |
| Parent navigation | src/pages/SettingsInterface.tsx; SettingsScreen.tsx; src/components/layout/AppWorkspaceShell.tsx; WorkspacePanel.tsx | Layout shell layering, mobile/back navigation, titles and sidebar, scroll background, both viewport sizes. |

All eight current navigation sections are enumerated. Context is included under Task Models because that is how SettingsContent.tsx renders it. No assumption that sharing SettingsSection or DropdownField means a page's remaining styles are correct.

### Settings style decisions

1. Define **one** primary action treatment, secondary action treatment, quiet/tertiary treatment, destructive action treatment, warning/notice panel treatment, and modal backdrop treatment, each with accessible foregrounds.
2. Use a semantic card/panel/field surface hierarchy. A card inside a dialog should not be darker/lighter merely because a different developer chose bg-background rather than bg-surface-muted.
3. Normalize active account, model, provider, and Settings navigation states around a common selected surface/border/foreground role. Keep status-specific badges separate.
4. For each Settings dialog, compare backdrop tint, dialog panel, header/footer, inputs, error banner, close button, disabled button, and focus/hover styles with every other dialog.
5. Preserve differences that convey meaning (destructive red, connected green, warning amber). Do not force them into brand green.
6. Skeleton shades should be recognizable but subdued relative to their local panel in both modes.
7. Ensure portal content inherits the root theme even when rendered outside SettingsContent.

## Whole-application surface inventory

The same standards must be checked on all non-Settings app-owned UI, **including components with handwritten className values, inline styles, and independent HTML**, not merely src/components/ui:

- Chat: src/components/AssistantMessage.tsx, UserMessage.tsx, ChatInput.tsx, MessageList.tsx; src/components/chat/**/*; src/pages/chatInterface/**/*; markdown renderers, composer, mention picker, attachment previews, tool execution, queued messages, search, diff viewers, history, code blocks, modals.
- Sidebar: src/components/sidebar/**/* including conversation dialogs, project picker, RemoteFolderPickerDialog, context menus, selection/hover, empty/loading/error.
- Workspace shell and tabs: src/components/layout/**/* and src/components/workspaceExplorer/**/* including Explorer rows, menus, editor tabs, terminal panel, diff panel, native Monaco widgets/search/hover, preview toolbar, image/PDF/DOCX/Markdown/SVG/plan previews and placeholders.
- Source control and commit: src/components/sourceControl/**/* and src/components/commit/**/*, diff summary, history graph and status dots/lines.
- Browser: src/components/browser/**/* (desktop browser only). Leave page contents to sites; theme TideCode shell and loading overlays.
- Remote UI: src/components/remote/**/*, src/remote/**/* for app-owned renderers, remote folder picker; special unauthenticated login page in electron/remote/webAuth.ts.
- Native chrome: electron/window/theme.ts, trayPopup.ts, the applicable coordination in electron/main.ts, bootstrap in index.html and src/main.tsx.

Audit all visible states: normal, hover, pressed, selected, expanded, focused, disabled, pending, loading, empty, warning, error, success, confirmation, popup/portal, overlay, and responsive/mobile.

## Target color taxonomy

Use the existing palette as the baseline, not a new aesthetic. Establish clearly named roles backed by a **single light/dark semantic contract**:

| Family | Required roles |
| --- | --- |
| Surfaces | canvas, shell/titlebar/sidebar, main panel, base card, muted field, raised/popover/modal, hover, pressed, selected, selected-hover, document-paper exception |
| Content | primary, secondary, subtle, disabled, inverse/on-action, on-soft-accent, placeholders, link |
| Outlines | default, subtle, strong/active, selected, focused where app styling supports it, semantic status borders |
| Brand/action | brand foreground, action background and on-action foreground, hover/pressed, soft accent background/foreground, disabled |
| Status | success, warning, danger, info, neutral with coordinated icon/text/background/border versions |
| Source control | added, removed, modified, renamed, untracked text and overlays; preserve the semantics across different Git screens |
| Editor/terminal | chrome background, line numbers, active/hover, selection, find highlights, diff insertion/removal, ANSI palette and code syntax exception |
| Overlay | modal backdrop, popover/tooltip surface and border, global scrollbar thumb/hover |
| Native/browser | window, titlebar, tray, theme-color meta, preboot error, remote login |

CSS variables in src/index.css remain the renderer source of truth. Introduce a small focused read/adapter module only where a library requires resolved string colors (e.g. xterm, Mermaid, Monaco). Native/prepaint/server-generated HTML cannot always read renderer CSS; mirror their minimal palettes with explicit tests/review and document these boundaries. Avoid a parallel large theme registry that can drift.

### Acceptance rules

- A semantic role maps to one authoritative light value and one authoritative dark value (plus deliberate state variants); no arbitrary per-feature near-duplicates.
- Text contrast targets WCAG AA 4.5:1 for normal text and 3:1 for large text and significant control boundaries; verify actual composited colors rather than token labels alone.
- No undefined semantic color class / CSS variable.
- No app-owned light-only warning/error/notice banners in dark mode or dark-only elements in light mode.
- No hidden theme transition that requires remounting or reload to update a visible component.
- Preserve intended white document paper, site themes, original image colors, terminal ANSI meaning, syntax colorization, and authentic third-party branding.

## Implementation order and checkpoints

1. **Token baseline and tests.** Inventory every nonstandard app-owned color usage across src and Electron, classify justified exceptions, define semantic roles, document a complete dark/light palette, and establish targeted automated checks.
2. **Settings first.** Update Settings shared primitives and each independently styled page/dialog identified in the matrix. Specifically fix Remote action contrast, Skills hover token, modal scrims, direct status dots, pills, card surfaces, fields, hover and selected states.
3. **Non-Settings components.** Map Chat, Explorer, Sidebar, Source Control, commits, dialogs, panels, code blocks and preview *chrome* to those roles. Validate exceptions individually.
4. **Special renderers.** Align Monaco structural colors with tokens and reapply on appearance changes; coordinate Shiki without degrading syntax. Align xterm surface/selection and ANSI palettes. Keep Mermaid token-based and rebuild on theme switch.
5. **Native, startup and remote login.** Align Electron window/titlebar/tray, preboot/meta, remote sign-in light/dark preference, app-owned browser overlays. Ensure browser login can decide appearance without authentication or fragile cross-origin assumptions.
6. **Full interaction audit.** Walk every Settings page and entire other-feature matrix in dark, light, and system modes, including portals and narrow remote viewport; record and fix remaining concrete visual mismatches.
7. **Verification and documentation.** Run focused tests, typecheck, lint, build, screenshot/manual checklist; update DESIGN.md and ARCHITECTURE.md to reflect implemented color roles/flow, not speculative details.

**Approval boundary:** Do not implement this plan without user approval. If visual audit discovers a new file needing a substantive change outside this list, amend the plan/file list before expanding work.

## Planned structure after implementation

~~~text
tidecode/
  index.html
  src/
    index.css                         # central semantic palette + states
    main.tsx                          # theme-aware boot error
    lib/
      theme.ts                        # resolved appearance / browser meta
      themeColorTokens.ts             # NEW: read tokens for JS-based renderers
    hooks/
      useDocumentTheme.ts             # existing resolver; change only if needed
      useResolvedDocumentTheme.ts     # existing observer; change only if needed
    components/
      ui/                             # shared controls
      settings/
        shared/                       # shared Settings visual treatments
        general/ providers/ models/ mcp/
        skills/ taskModels/ context/ remote/ updates/
      chat/ workspaceExplorer/ sidebar/ sourceControl/
      browser/ commit/ remote/ layout/
    pages/
      chatInterface/
      SettingsInterface.tsx
  electron/
    main.ts
    window/theme.ts
    window/trayPopup.ts
    remote/webAuth.ts
  tests/
    themeSynchronization.test.ts
    themeColorConsistency.test.ts     # NEW
    workspaceMonacoConfig.test.ts
    workspaceTerminalPanelUtils.test.ts
  DESIGN.md
  ARCHITECTURE.md
  docs/plan/plan-090.md               # THIS PLAN
~~~

Do not create a new component per page merely for colors; prefer well-scoped shared tokens/roles and existing control primitives. Specialized renderer mappings live next to their existing modules.

## Explicit anticipated file changes

All names here are relative to the repository root. Every listed item is **MODIFY** unless marked **CREATE**. Some pages may require no edit after visual verification; those are listed separately as audit-only below.

### A. Theme foundation, native chrome and server-generated pages

- CREATE src/lib/themeColorTokens.ts: small CSS semantic token resolver for JS-only renderers with documented safety fallbacks.
- MODIFY src/index.css: coherent two-mode palette, semantic surfaces, status roles, modal/selection/hover definitions and existing component variables.
- MODIFY src/lib/theme.ts: align browser theme-color and preference handling with the selected palette.
- MODIFY index.html: use aligned prepaint metadata/theme values.
- MODIFY src/main.tsx: theme-aware boot error surface.
- MODIFY electron/window/theme.ts: align native window/titlebar colors.
- MODIFY electron/window/trayPopup.ts: align popup colors and selected appearance.
- MODIFY electron/main.ts: pass/synchronize appearance to native popup only if the existing themeSource propagation is insufficient.
- MODIFY electron/remote/webAuth.ts: light/dark login page and prepaint preference without changing server auth/session logic.

### B. Settings foundation and navigation

- MODIFY src/components/settings/shared/SettingsPanelPrimitives.tsx: consistent section/row backgrounds and text roles.
- MODIFY src/components/settings/shared/SettingsSkeletonPrimitives.tsx: consistent skeleton colors.
- MODIFY src/components/settings/shared/actionButtonStyles.ts: named Settings action treatments, semantic foreground pairs.
- MODIFY src/components/settings/shared/statusPillStyles.ts: decouple status tones from selection control tokens.
- MODIFY src/components/settings/SettingsSidebarPanel.tsx: selected/hover/nav item semantics.
- MODIFY src/components/settings/SettingsContent.tsx: consistent mobile back action and content surface.
- MODIFY src/components/ui/DropdownField.tsx: menu hover/active/selected/disabled/focus colors.
- MODIFY src/components/ui/SegmentedField.tsx: selected and idle states; use semantic Git counters.
- MODIFY src/components/ui/Switch.tsx: checked/unchecked and thumb contrast.
- MODIFY src/components/Tooltip.tsx: verify root semantic tooltip surface/foreground and portal handling (edit only if validation reveals an exception).

### C. Settings direct component implementations

- MODIFY src/components/settings/providers/ProvidersSettingsPanel.tsx: primary action consistency.
- MODIFY src/components/settings/providers/ProviderCard.tsx: card state tones.
- MODIFY src/components/settings/providers/ProviderConfigDialog.tsx: dialog surface, fields, overlay, actions.
- MODIFY src/components/settings/providers/CodexProviderDialog.tsx: dialog and actions.
- MODIFY src/components/settings/providers/CodexAccountsList.tsx: active/idle account card surfaces.
- MODIFY src/components/settings/providers/CodexAccountDropdown.tsx: inspect/normalize independent popup states.
- MODIFY src/components/settings/providers/CodexUsagePills.tsx: badge/usage tone contrast.
- MODIFY src/components/settings/models/ModelsSettingsPanel.tsx: search surface, model list, warnings and actions.
- MODIFY src/components/settings/models/ModelsProviderSection.tsx: selected/provider badges and list rows.
- MODIFY src/components/settings/models/UserModelDialog.tsx: form controls, backdrop, errors.
- MODIFY src/components/settings/models/RemoveUserModelDialog.tsx: destructive confirmation and scrim.
- MODIFY src/components/settings/mcp/McpServersSettingsPanel.tsx: create action/status rows.
- MODIFY src/components/settings/mcp/McpServerCard.tsx: status icons/colored controls/card surfaces.
- MODIFY src/components/settings/mcp/McpAddDialog.tsx: overlay, form and action hierarchy.
- MODIFY src/components/settings/mcp/McpRemoveDialog.tsx: destructive confirmation and scrim.
- MODIFY src/components/settings/skills/SkillsSettingsPanel.tsx: actions and status.
- MODIFY src/components/settings/skills/SkillCard.tsx: selected/hover card background.
- MODIFY src/components/settings/skills/SkillAddDialog.tsx: undefined hover token, modal backdrop, form/action hierarchy.
- MODIFY src/components/settings/taskModels/TaskModelConfigurationCard.tsx: selected configuration tone.
- MODIFY src/components/settings/taskModels/TaskModelConfigurationDialog.tsx: modal/action and picker colors.
- MODIFY src/components/settings/remote/RemoteSettingsPanel.tsx: **P0 light-mode action contrast**, input/card/status surface hierarchy.
- MODIFY src/components/settings/updates/UpdatesSettingsPanel.tsx: update action and status consistency.

### D. Chat, Explorer, Source Control, previews and embedded renderers

- MODIFY src/components/browser/BrowserPanel.tsx: app-owned browser loading overlays, theme fallback values.
- MODIFY src/components/chat/ChatMentionMenu.tsx: mention icon colors mapped to light/dark pairs where needed.
- MODIFY src/components/chat/ChatMentionText.tsx: semantic mention highlights.
- MODIFY src/components/chat/ConversationDiffFileItem.tsx: Git stats.
- MODIFY src/components/chat/DiffPanelToggle.tsx: Git stats.
- MODIFY src/components/chat/MarkdownRenderer.tsx: highlight warning/mark colors.
- MODIFY src/components/chat/ToolInvocationBlock.tsx: Git stats/statuses.
- MODIFY src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils.ts: semantic xterm theme, accessible separate ANSI light/dark palette.
- MODIFY src/components/commit/CommitModal.tsx: Git stats and action colors.
- MODIFY src/components/remote/RemoteAccessIndicator.tsx: semantic status dots.
- MODIFY src/pages/chatInterface/ChatWorkspaceHeaderControls.tsx: Git counters.
- MODIFY src/components/sourceControl/CommitFileRow.tsx: Git statuses.
- MODIFY src/components/sourceControl/CommitHistoryTooltipContent.tsx: Git counters.
- MODIFY src/components/sourceControl/PublishToGitHubModal.tsx: errors, status surfaces, third-party branded exceptions.
- MODIFY src/components/sourceControl/SourceControlNoRepoView.tsx: warning/error/success states.
- MODIFY src/components/sourceControl/VirtualizedSourceControlDiffList.tsx: Git counters and status indicators.
- MODIFY src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerEntryRow.tsx: Git file status tones.
- MODIFY src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTheme.ts: semantic editor chrome and widget colors.
- MODIFY src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoShiki.ts: preserve token highlighting and align editor background/foreground.
- MODIFY src/components/workspaceExplorer/workspaceFileEditor/useWorkspaceMonacoEditor.ts: update theme color mappings after appearance changes if existing theme-registration caching prevents updates.
- MODIFY src/components/workspaceExplorer/workspaceMarkdownPreview/mermaid-utils.ts: semantic Mermaid palette.
- MODIFY src/components/workspaceExplorer/workspaceMarkdownPreview/WorkspaceMarkdownPreviewView.tsx: warning and mark colors.
- MODIFY src/components/workspaceExplorer/workspacePlanPreview/WorkspacePlanPreview.tsx: warning surface.
- MODIFY src/components/workspaceExplorer/workspaceSvgPreview/WorkspaceSvgPreviewView.tsx: warning surface.

### E. Tests and design documentation

- CREATE tests/themeColorConsistency.test.ts: test required semantic token definitions, exception inventory and forbidden undefined color roles, plus measurable safe color pairs where feasible.
- MODIFY tests/themeSynchronization.test.ts: cover appearance selection, prepaint/meta/native coordination where testable.
- MODIFY tests/workspaceMonacoConfig.test.ts: verify editor light/dark mapping, selection/widget contrast roles.
- MODIFY tests/workspaceTerminalPanelUtils.test.ts: verify theme switching and terminal role/ANSI mappings.
- MODIFY DESIGN.md: record actual implemented color roles, UI states, and intentional exception policy.
- MODIFY ARCHITECTURE.md: document one token owner, JS integrations, and native/server-generated exceptions.

### F. Explicitly inspected or inventoried, but **no change presumed**

- src/components/settings/general/GeneralSettingsPanel.tsx, GeneralSettingsSkeleton.tsx: their primary color decisions already go through shared controls and tokens.
- src/components/settings/context/ContextSettingsPanel.tsx: field semantics mostly inherited from shared dropdown and action/range token.
- src/components/settings/models/ModelsSettingsSkeleton.tsx and the non-view model catalog/storage modules: no separate arbitrary palette found.
- src/components/settings/providers/ProvidersSettingsSkeleton.tsx and providerSchemas.ts: visual skeleton relies on shared tokens, schema non-visual.
- src/components/settings/mcp/McpServerList.tsx, McpServersSettingsSkeleton.tsx: semantic existing styles; verify rendered result.
- src/components/settings/skills/SkillList.tsx, SkillsSettingsSkeleton.tsx: semantic existing styles.
- src/components/settings/taskModels/TaskModelsSettingsPanel.tsx, TaskModelsSettingsSkeleton.tsx: shared controls/token-based appearance.
- src/components/settings/remote/RemoteSettingsSkeleton.tsx: semantic existing styles.
- src/components/settings/shared/LineNumberedTextarea.tsx: semantic existing styles.
- src/components/settings/SettingsPlaceholderPanel.tsx: currently appears unreferenced in src, keep untouched unless it is reached.
- src/pages/SettingsInterface.tsx, SettingsScreen.tsx and src/components/layout/AppWorkspaceShell.tsx, WorkspacePanel.tsx: shared shell already handles theme roles; no logic refactor planned.
- src/components/sidebar/*, sourceControl/historyGraph*.tsx, workspaceExplorer/workspacePdfPreview/*, workspaceDocxPreview/*, workspaceImagePreview/*: inspect rendered chrome carefully, preserve document content, add specific file changes to plan only if a demonstrated mismatch requires them.
- src/lib/fileIconConfig.ts: keep intentional file-type icon color categories.
- src/lib/codeHighlighting.ts: retain GitHub syntax token palettes unless visual testing reveals a measured readability problem.
- src/hooks/useDocumentTheme.ts and src/hooks/useResolvedDocumentTheme.ts: existing theme event flows; modify only if switching tests demonstrate missed updates.

These audit-only listings are not blanket certifications. They ensure low-level and page-local controls remain on the verification checklist even when no source edits are currently predicted.

## Verification matrix

### Automated

- Focused node tests: tests/themeSynchronization.test.ts, new themeColorConsistency.test.ts, tests/workspaceMonacoConfig.test.ts, tests/workspaceTerminalPanelUtils.test.ts.
- npm run typecheck, npm run lint, relevant node tests, npm run build, and git diff --check.
- Check no undefined Tailwind semantic token class exists; test the specific surface-hover case.
- Check no unreviewed literal warning/error banner palette is introduced in app-owned TSX.
- Check both appearances of representative background/foreground, on-action, on-soft-brand, on-danger, on-warning, inactive, disabled, and selected pairs for contrast.
- Do not break existing document, editor, terminal, authentication, or theme persistence tests.

### Manual / screenshot comparisons in **both** appearances

For **each** of General, Providers, Models, MCP, Skills, Task Models+Context, Updates and Remote:
- Default view and navigation selected state.
- Every dialog and nested popup: fresh/open/expanded/loading/error/success/disabled states.
- Hover/pressed/selected controls, available badges, skeleton/empty views.
- Desktop width and mobile width on supported surfaces.
- Side-by-side color-role comparison against every other Settings section.

For **each** of Chat, sidebar/project dialogs, workspace Explorer/editor, source control, terminal, Markdown/SVG/PDF/DOCX/plan/ image previews, embedded browser chrome, and remote folder picker:
- Background/surface stack, controls, status colors and popovers.
- Preserve white document pages and arbitrary user/web content where intentional.
- Test mouse/touch and platform-responsive states where applicable.

For native/remote:
- Electron light/dark/system and OS theme changes, startup error if reproducible.
- Window native titlebar/tray and browser loading view.
- Remote web unauthenticated login, both themes, with system and saved browser appearance; also the authenticated desktop-sized and mobile-sized remote UI.
- Switching while menus, Monaco, xterm, Mermaid, and dialogs are open: no stale colors or visual flashing.
- Account for independent remote-browser appearance preferences; do not inadvertently copy desktop appearance settings to another device.

### Release gate

Complete only when the full Settings coverage matrix and whole-application matrix have been checked in both appearances; the mismatches identified above are fixed; automated checks and relevant builds pass; and any intentional exceptions are recorded. Any item not actually rendered/tested must be explicitly reported as unverified, not silently marked complete.

## Non-goals and constraints

- No redesign, layout or typography overhaul, additional themes, or new accent-color selection.
- No modification of authenticated remote endpoints or session/credential handling.
- No recoloring user files, images, websites, syntax tokens merely for numeric uniformity.
- No unrelated code cleanup, repository merges, commits, pushes, or release creation unless separately requested.
- Keep existing app behavior and native/remote availability unchanged.

**Next action after approval:** Implement this plan in checkpoints, starting with theme roles and the complete Settings matrix. Recheck the file list against newly demonstrated visual defects before any additional source-file edits.

## Implementation result

### Accent contrast follow-up

Following additional visual feedback, the overly bright mint action fill in dark mode was rolled back to the prior muted forest-green action fill with light foreground. Light mode now uses medium sage-green with dark foreground to suit the light canvas. The unchecked dark-mode switch track was softened without losing contrast, while the checked switches remain aligned with button actions. The Remote login page mirrors both palettes. Tests enforce readable action fill/text and switch contrast in each mode.

### Sidebar-neutral light-control correction

The subsequent Models Settings screenshot showed the light-mode medium sage-green Add model button and dark checked-switch thumbs clashing with the neutral sidebar and content surfaces. The light action was replaced with subdued charcoal-gray and white content, matching the sidebar's neutral foreground hierarchy rather than introducing a solid sage accent. The unchecked light-mode track is neutral gray. Dark mode retains its previously accepted muted forest-green action and light thumb; Remote login follows the same action palette. Existing button/switch contrast tests now lock the corrected light and dark states.

### Exact sidebar-color controls

After the user clarified that the sidebar color itself is the required appearance, replaced the interim charcoal/forest action treatment with the exact sidebar tokens in both modes: `#eef1ef` light and `#131314` dark. Action hover follows each theme's sidebar-muted token. Text and checked switch thumbs use the respective inverse foreground, while disabled/off tracks remain clearly distinct. A subtle inset border on primary buttons, checked switches, and the Remote login button preserves visible control bounds without introducing another accent. Palette regression checks assert that action and sidebar colors remain matched.

### Active history-item accent correction

The user provided a screenshot of a selected conversation-history row. Source review confirmed that it uses `--sidebar-item-active-surface` bound to `--color-brand-soft`, *not* `--color-sidebar`. Corrected primary button fills and checked switch tracks to use the same soft green selected color (`#d9e9e6` light / `#223630` dark), with brand-soft foreground for labels and switch thumbs, accent-hover for hover, and the active sidebar item border. Remote login mirrors the change. The regression test now checks the conversation-history source mapping as well as action-to-brand-soft token equality in both themes.

Additional control audit found MCP card buttons/tool toggles using inline action fills and borders set to the same color as the fill. These now use the same action utility, hover, text, and selected-border roles as primary Settings controls.

Implemented on `develop` after approval. The renderer now has explicit inverse surface hierarchies: light mode moves from the light canvas into darker muted/hover/pressed states, while dark mode moves from the near-black canvas into progressively lighter panel, field, raised, hover, and pressed states. Settings-specific controls, dialogs, overlays, status colors, Git indicators, preview warnings, Monaco chrome, terminal colors, native window/tray colors, startup error rendering, and Remote login were brought under the same semantic contract while preserving the intentional content/brand exceptions listed above.

Automated verification after implementation:

- `npm run typecheck`: passed.
- Focused theme/Remote/Monaco/terminal checks: passed, including the app-wide raw theme-utility guard.
- Full `npm test`: 1,577 passed, 0 failed, 1 skipped.
- `npm run build`: passed for renderer, Electron, preload, CLI, and run-service bundles.
- Changed-file ESLint invocation: exited successfully after fixing the introduced Mermaid dependency warning.
- `git diff --check`: passed.
- Full repository `npm run lint`: remains blocked by existing repository lint debt (169 errors and 6 warnings across unrelated tooling, scripts, tests, workers, and existing source warnings). The theme implementation did not attempt unrelated lint cleanup.

Manual screenshot/runtime comparison of every matrix entry is still unverified in this implementation session and must not be represented as completed visual QA.
