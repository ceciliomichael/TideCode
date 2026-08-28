# Plan 054: Make Text Selection Opt-In Globally

## Goal

Disable accidental text selection across the application, including portal-rendered menus and dialogs, then explicitly opt meaningful content back in.

## Changes

- Replace the current component-scoped selection rules with a global non-selectable default covering the app and body-level portals.
- Keep inputs, textareas, and contenteditable fields selectable/editable, while keeping their placeholders non-selectable.
- Preserve selectable content by applying the existing `selectable-ui` convention to Markdown/chat content, editors, previews, terminal output, and other meaningful text surfaces.
- Keep diff and panel chrome non-selectable so Ctrl+A outside an actual content/editor surface does not select the surrounding UI.
- Reuse the current CSS convention without adding dependencies or unrelated refactors.

## Verification

- Run `npm run typecheck`.
- Run `git diff --check`.
- Search for remaining meaningful text surfaces that need an explicit selectable override.
