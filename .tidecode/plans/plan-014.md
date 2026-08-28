---
status: implementation_started
---

# Prevent accidental text selection in sidebar and settings UI

## Goal
Make the static UI text shown in the sidebar and Settings screen non-selectable, matching the screenshots, while preserving normal text selection inside editable fields.

## Findings
- The main app sidebar is rooted at `src/components/sidebar/SidebarPanel.tsx`.
- The Settings navigation sidebar is rooted at `src/components/settings/SettingsSidebarPanel.tsx`.
- All Settings page content is rooted at the `settings-scroll-viewport` element in `src/components/settings/SettingsContent.tsx`.
- `src/index.css` already contains browser-specific `user-select` handling for terminal accessibility text, so the shared selection rule belongs there.
- Search/settings forms contain editable inputs and textareas; disabling selection on an entire surface without an exception would make their text-selection behavior inconsistent.

## Implementation
1. Add a small reusable CSS class in `src/index.css` that disables standard and WebKit text selection for the marked UI surface and its descendants.
2. Add scoped exceptions for `input`, `textarea`, and contenteditable elements so users can still select/copy/edit entered text.
3. Mark the app sidebar, Settings sidebar, and Settings content viewport with that class. This covers labels, descriptions, buttons, navigation text, thread/project names, and section headings without affecting chat messages or the workspace editor.
4. Leave portal-based dialogs and editor/chat content outside this change unless they are rendered inside one of the marked surfaces; their editable fields must remain usable.

## Verification
- Run `npm run typecheck`.
- Inspect the final diff to confirm only the sidebar/settings surfaces and the shared selection rule changed.
- Manually verify that dragging across sidebar/settings labels does not highlight text, while the sidebar search and settings text fields still allow text selection and editing.
