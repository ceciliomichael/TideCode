# Plan 089 - Mobile Explorer and File Preview Flow

## Goal

Add a mobile-first workspace explorer flow that takes over the workspace content area instead of rendering the desktop sidebar/tabs UI.

## Mobile navigation

- Add Explorer to the top-right mobile workspace controls.
- Explorer becomes a mobile workspace surface alongside Chat, Terminal, and Board.
- Opening Explorer shows the workspace tree full-screen below the mobile header.
- Opening a file transitions to a single-file full-screen view.
- No workspace tab strip is rendered on mobile.
- Back navigation:
  - Preview -> File
  - File -> Explorer
  - Explorer -> Chat

## Explorer presentation

Reuse the existing WorkspaceExplorerPanel state and actions, but add a mobile presentation that:

- fills the available content area;
- removes the desktop fixed width / resize handle;
- removes the desktop-only sidebar border and breakpoint hiding;
- lets the mobile surface provide its own navigation header;
- preserves create, rename, delete, copy, cut, paste, drag/drop, keyboard handling, and tree loading behavior.

Desktop presentation remains unchanged.

## Mobile file view

Reuse TideCode's existing workspace file tab state internally for file loading, autosave, and preview data, but do not render tabs on mobile.

The mobile file screen contains:

- Back button to Explorer;
- current file name/path;
- Preview action for previewable files;
- existing Monaco editor for editable text files;
- existing loading/error states.

Binary previewable files show a lightweight file state until Preview is selected rather than immediately opening the preview renderer.

## Preview mode

Preview button is available for:

- Markdown;
- SVG;
- PDF;
- DOCX;
- image formats already supported by TideCode.

Markdown and SVG reuse the existing preview-tab loaders internally. PDF, DOCX, and images reuse preview data already attached to the file state.

Preview mode uses the existing preview renderer stack and has a Back action returning to the file view.

Plan previews continue using their existing plan-preview behavior.

## Files

- src/pages/chatInterface/MobileWorkspaceHeader.tsx
- src/pages/chatInterface/ChatInterfaceContent.tsx
- src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerPanelTypes.ts
- src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerPanelView.tsx
- src/components/workspaceExplorer/MobileWorkspaceExplorerSurface.tsx
- focused tests for mobile surface helpers if pure navigation/preview resolution helpers are introduced.

## Verification

- npm run typecheck
- focused workspace explorer / mobile tests
- git diff --check

Manual checks:

1. Mobile header shows Explorer beside the existing workspace actions.
2. Explorer takes over the mobile workspace area.
3. File tap opens a single-file view with no tab strip.
4. Back from file returns to Explorer.
5. Back from Explorer returns to chat.
6. Markdown and SVG show Preview and return correctly.
7. PDF, DOCX, and images open through Preview.
8. Text edits still autosave through the existing workspace state.
9. Desktop Explorer and workspace tabs remain unchanged.
