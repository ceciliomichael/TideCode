# Plan 088 - Workspace Explorer Keyboard UX

## Goal

Make the workspace explorer feel like a native desktop file explorer by adding predictable keyboard navigation and file-management shortcuts while preserving the existing selection, clipboard, undo, context-menu, and inline edit behavior.

## Existing behavior to preserve

- Delete removes the current selection.
- Ctrl/Cmd+C copies selected entries.
- Ctrl/Cmd+X cuts selected entries.
- Ctrl/Cmd+V pastes into the resolved target directory.
- Ctrl/Cmd+A selects loaded entries in the current selection directory.
- Ctrl/Cmd+Z uses the explorer undo stack.
- Rename/create text inputs keep their own Enter/Escape behavior.
- Shortcuts remain scoped to the focused explorer and must not affect the editor or other TideCode surfaces.

## Changes

### src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerSelection.ts

Extend the explorer keyboard handler with:

- F2: rename the single selected entry.
- Enter: open the selected file or toggle the selected directory.
- ArrowDown / ArrowUp: select the next/previous visible tree row.
- ArrowRight: expand a collapsed directory, or select its first visible child when already expanded.
- ArrowLeft: collapse an expanded directory, or select its parent directory.
- Escape: clear explorer selection when no inline editor is active.
- Ctrl/Cmd+N: create a file in the resolved current directory.
- Ctrl/Cmd+Shift+N: create a folder in the resolved current directory.

Build visible-row navigation from the loaded/expanded explorer state so collapsed descendants are skipped.

Keep shortcut handling disabled for text/editable targets.

### src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerPanelState.ts

Wire rename and creation actions into the selection keyboard controller.

Resolve F2 only when exactly one loaded entry is selected.

Reuse the existing rename/create hooks rather than introducing duplicate mutation logic.

### src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerEntryRow.tsx

No behavior rewrite. Keep rows as the canonical visible keyboard targets and ensure programmatic keyboard selection can scroll the selected row into view.

### src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerSelectionUtils.ts

Add small pure helpers if needed for:

- flattened visible entry ordering;
- parent/child keyboard navigation;
- resolving the create target directory.

Keep traversal logic testable and independent of React.

### tests/components/workspaceExplorer/workspaceExplorerSelectionUtils.test.ts

Add focused coverage for:

- visible-order traversal through expanded/collapsed directories;
- parent/first-child resolution;
- directory target resolution for new file/folder shortcuts;
- edge cases at the first/last visible entry.

## Verification

- npm run typecheck
- focused workspace explorer tests
- git diff --check

Manual checks:

1. Select a file and press F2; rename starts with the filename selected.
2. Enter opens files and toggles folders.
3. Arrow navigation follows only visible rows and scrolls selection into view.
4. Left/right folder navigation matches desktop explorer behavior.
5. Ctrl+N and Ctrl+Shift+N create in the expected directory.
6. Escape clears selection but does not interfere with active rename/create inputs.
7. Existing Delete, copy, cut, paste, select-all, and undo shortcuts still work.
8. Explorer shortcuts do not fire while focus is in Monaco, chat, terminal, browser, or explorer text inputs.
