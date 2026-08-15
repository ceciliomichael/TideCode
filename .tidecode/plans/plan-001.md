---
status: implementation_started
---

# VS Code-like Explorer Selection Focus, Copy/Paste, and Commit-on-Blur Creation

## Summary

Bring the workspace explorer's selection behavior in line with VS Code: (1) the selected/active file highlight is solid while the explorer has keyboard focus and fades to a paler variant when focus is elsewhere; (2) Ctrl+C/X/V and Delete keep working whenever the explorer has focus (VS Code semantics: one click on a row, then Ctrl+C copies immediately); (3) pasting targets the directory of the current selection, INTO a selected folder, or the root after clicking empty space, with the keyboard and native-paste paths unified; (4) clicking away from a create/rename input commits the change instead of discarding it (Windows/VS Code behavior), while Escape and empty names still cancel.

## Problem and context

User-reported explorer UX issues:

1. When a file is open and the user presses Ctrl+C outside the tree, nothing is copied; the user must click the file row again first ("currently its making me click it to make sure I am able to copy it").
2. Paste target behavior feels inconsistent: they want paste to land in the directory of the current selection (e.g. file1.txt selected inside folder1 pastes into folder1), or at the root when clicking empty space.
3. Creating a file/folder and then clicking anywhere (without pressing Enter) currently cancels creation instead of committing it.
4. The active-file highlight does not communicate focus state (VS Code shows a paler "inactive selection" when focus is elsewhere).

The user explicitly requested behavior "as close to vscode as possible", so shortcut scope stays explorer-focused (Ctrl+C in the editor copies text; it does not copy files).

## Goals

- Solid vs. pale highlight for selected/active entries based on explorer focus, matching VS Code's active/inactive selection.
- Ctrl+C/X/V/Delete work whenever the explorer tree has focus, including right after clicking a row (no second click needed), and after using the context menu (tree regains focus).
- Single source of truth for paste targeting used by both the Ctrl+V key handler and the native paste (onPasteCapture) path.
- Create and rename commit on blur (click-away), cancel on Escape or empty name, and keep the input focused when a validation error leaves the draft open.
- Active-file auto-reveal, scroll-into-view, and cut-dimming behavior unchanged (already working; verified manually).

## Non-goals / scope

- No global (app-wide) file copy/paste shortcuts. Ctrl+C/V in the Monaco editor, chat input, terminal, or search fields keep their native behavior.
- No changes to drag-and-drop moves, context menu items, delete dialog, undo stack, or workspace watching.
- No changes to the OS-clipboard file import flow (importing files copied from the OS file explorer), other than routing its target through the unified helper.

## Current state and evidence

- `src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerEntryRow.tsx` (lines 62-64): rows use `bg-brand-soft text-foreground` for `isSelectedEntry || isActiveFile || isContextTarget || isDropTarget` regardless of focus; no paler variant exists.
- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerSelection.ts` (lines 166-271): `handleTreeKeyDown` handles Ctrl+C/X/V, Ctrl+A, Ctrl+Z, Delete, scoped to the tree container via `onKeyDownCapture`; paste target computed inline at lines 229-236 (single selected directory pastes INTO it, otherwise `selectionDirectoryPath`).
- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerTransfers.ts` (lines 188-211): `handleExplorerPaste` (native paste via `onPasteCapture`) always pastes to `selectionDirectoryPath` - it does NOT paste into a selected folder. This is the inconsistency vs. the keyboard path.
- `src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerPanelView.tsx`: creation input (lines 125-143) and rename input (lines 183-201) both `onBlur` -> `cancelCreateEntry()` / `cancelRenameEntry()` - click-away discards instead of committing.
- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerPanelState.ts`: has `treeContainerRef` and `contextMenuState`; no focus tracking. Active file selection sync effect exists (lines 269-288); empty-space click clears selection and sets `selectionDirectoryPath` to root (`clearEntrySelection`, selection hook lines 75-79).
- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerContextMenu.ts`: `closeContextMenu` (lines 41-43) does not restore focus to the tree, so after any context-menu action focus lands on `document.body` and the tree no longer receives keyboard shortcuts until re-clicked.
- `src/index.css`: `--color-brand-soft` defined in `@theme` (line 29) and overridden for dark in `:root[data-theme='dark']` (line 111). No faint/inactive variant.
- `src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerSelectionUtils.ts`: contains `getSelectionDirectoryPath`, `findLoadedExplorerEntry`, `isTreeShortcutTarget` - the natural home for the paste-target helper.
- Tests live in `tests/components/workspaceExplorer/*.test.ts` (node:test style, run via `npm test`).

## Proposed solution

### 1. Focus-aware selection highlight (VS Code active/inactive)

- Add `isExplorerFocused` state in `useWorkspaceExplorerPanelState`, maintained with `focusin`/`focusout` listeners on `treeContainerRef.current` (capture phase, inside a `useEffect`):
  - `focusin` on the container -> true.
  - `focusout` -> keep true if `relatedTarget` is a `Node` contained in the container, or if `contextMenuState` is non-null (menu open keeps the row solid); otherwise false.
  - Reset to false when the workspace root changes or the panel closes (extend the existing reset effects).
- Expose `isExplorerFocused` from the panel state and pass it to every `WorkspaceExplorerEntryRow` as a new `isSelectionFocused` prop; add it to the memo comparator.
- Row styling: drop-target and focused highlighted rows keep `bg-brand-soft text-foreground`; highlighted rows while unfocused use a new `bg-brand-soft-faint text-foreground`.
- Add `--color-brand-soft-faint` to `@theme` in `src/index.css`: `color-mix(in srgb, var(--color-brand-soft) 55%, var(--color-surface))`. Because `--color-brand-soft` and `--color-surface` are overridden in `:root[data-theme='dark']`, the mix resolves per theme automatically. Verify contrast in both themes; if the dark value looks wrong, add an explicit dark override next to line 111.
- Restore tree focus after context-menu actions: pass `treeContainerRef` into `useWorkspaceExplorerContextMenu`; keep a small ref flag set in `openContextMenu`; in `closeContextMenu`, if a menu was open, call `treeContainerRef.current?.focus({ preventScroll: true })` before clearing state. This matches VS Code (tree keeps focus after menu actions) and keeps the highlight solid.

### 2. Explorer-scoped shortcuts (unchanged scope, guaranteed focus)

- Keep `onKeyDownCapture={panelState.handleTreeKeyDown}` and `onPasteCapture` on the tree container. No new global key listeners (VS Code semantics).
- The focus restoration from section 1 plus the existing click-to-focus on row buttons means: click a row once -> Ctrl+C/X/V/Delete work immediately; click elsewhere -> highlight fades and shortcuts no longer apply (native editor copy takes over). This directly resolves the "must click it to make sure I am able to copy it" complaint for the open-file case.

### 3. Unified paste target

- Add `resolvePasteTargetDirectoryPath({ selectedEntryPaths, selectionDirectoryPath, rootEntries, directoryEntriesByPath })` to `workspaceExplorerSelectionUtils.ts`:
  - No selection -> `selectionDirectoryPath` (root after an empty-space click; directory after a move, matching the "last focused directory" feel).
  - Exactly one selected entry and it resolves (via `findLoadedExplorerEntry`) to a directory -> `toDirectoryKey(entry.relativePath)` (paste INTO the selected folder).
  - Otherwise (single file, multiple selection, or selected directory not loaded) -> `selectionDirectoryPath` (the directory containing the selection).
- Use it in both call sites:
  - `useWorkspaceExplorerSelection.ts` keyboard paste handler (replace lines 229-236).
  - `useWorkspaceExplorerTransfers.ts` `handleExplorerPaste` (replace direct `selectionDirectoryPath` uses at lines 198 and 208; the hook already receives `rootEntries`, `directoryEntriesByPath`, `selectedEntryPaths`).
- Context-menu Paste keeps its explicit target (right-clicked folder or root) - already correct and VS Code-like.

### 4. Commit-on-blur for create and rename

- `WorkspaceExplorerPanelView.tsx` creation input `onBlur`: if `isSubmittingCreationRef.current` return; if trimmed name is empty -> `cancelCreateEntry()`; else `void submitCreateEntry()`.
- Rename input `onBlur`: same pattern with `isSubmittingRenameRef` / `renameName` / `submitRenameEntry()`. Rename with an unchanged name already cancels inside `submitRenameEntry` (lines 116-119).
- In `useWorkspaceExplorerCreation.submitCreateEntry` and `useWorkspaceExplorerRename.submitRenameEntry`, on the path-separator validation failure (the only case where the draft stays open without an error dialog), refocus the input via `requestAnimationFrame(() => inputRef.current?.focus())` so a blur-triggered submit with an invalid name does not strand the draft unfocused. The existing `isSubmitting*Ref` guards already prevent double-submit when the input unmounts.

## Detailed implementation steps

1. `src/index.css`: add `--color-brand-soft-faint: color-mix(in srgb, var(--color-brand-soft) 55%, var(--color-surface));` inside `@theme`. Optionally add an explicit dark override after line 111 if the mixed value fails the visual check.
2. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerPanelState.ts`:
   - Add `const [isExplorerFocused, setIsExplorerFocused] = useState(false)`.
   - Add a `useEffect` that attaches `focusin`/`focusout` (capture) to `treeContainerRef.current` with the containment + `contextMenuState` logic; deps `[contextMenuState, treeContainerRef]` (or use a ref for the menu state to avoid re-subscribing; either is fine).
   - Reset `isExplorerFocused` to false in the existing `workspaceRootPath` reset effect and in the `!isOpen` effect.
   - Return `isExplorerFocused`.
3. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerContextMenu.ts`:
   - Accept a `treeContainerRef` option; set a `wasMenuOpenRef` in `openContextMenu`; in `closeContextMenu`, if the flag is set, `treeContainerRef.current?.focus({ preventScroll: true })` and clear the flag before `setContextMenuState(null)`.
   - Pass `treeContainerRef` from `useWorkspaceExplorerPanelState`.
4. `src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerEntryRow.tsx`:
   - Add `isSelectionFocused: boolean` to props and to `areWorkspaceExplorerEntryRowPropsEqual`.
   - Replace the `rowStateClass` computation: drop target stays solid; highlighted rows use `bg-brand-soft text-foreground` when focused and `bg-brand-soft-faint text-foreground` when not; default hover classes unchanged.
5. `src/components/workspaceExplorer/workspaceExplorerPanel/WorkspaceExplorerPanelView.tsx`:
   - Pass `isSelectionFocused={panelState.isExplorerFocused}` to `WorkspaceExplorerEntryRow`.
   - Creation input `onBlur`: commit-or-cancel logic (empty -> cancel, else submit) behind the `isSubmittingCreationRef` guard.
   - Rename input `onBlur`: same logic with rename refs/state.
6. `src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerSelectionUtils.ts`: add `resolvePasteTargetDirectoryPath` (needs `findLoadedExplorerEntry`, `toDirectoryKey` - both already imported or in this module).
7. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerSelection.ts`: replace the inline paste-target computation (lines 229-236) with `resolvePasteTargetDirectoryPath`.
8. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerTransfers.ts`: replace `selectionDirectoryPath` with `resolvePasteTargetDirectoryPath(...)` in both branches of `handleExplorerPaste`; add the helper to imports.
9. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerCreation.ts`: refocus `creationInputRef` via rAF on the path-separator validation failure branch.
10. `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerRename.ts`: refocus `renameInputRef` via rAF on the path-separator validation failure branch.
11. `tests/components/workspaceExplorer/workspaceExplorerSelectionUtils.test.ts` (new): unit tests for `resolvePasteTargetDirectoryPath` (see Verification).

## Contracts / data / integrations

- No IPC, store, or type changes. `WorkspaceClipboardEntry`, `workspaceClipboardTypes.ts`, and all existing props stay unchanged.
- New prop `isSelectionFocused` on `WorkspaceExplorerEntryRow` (internal component; update its comparator or memoization silently breaks).
- New exported helper `resolvePasteTargetDirectoryPath` in `workspaceExplorerSelectionUtils.ts` with signature:
  `(options: { selectedEntryPaths: Set<string>; selectionDirectoryPath: string; rootEntries: WorkspaceExplorerEntry[]; directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]> }) => string`.

## Verification / test plan

- `npm run typecheck`, `npm run lint`, `npm test` (new tests must pass; existing explorer tests must not regress).
- New unit tests for `resolvePasteTargetDirectoryPath` (node:test style, mirroring `tests/components/workspaceExplorer/workspaceExplorerPanelUtils.test.ts`):
  - single selected directory (loaded in tree) -> that directory's key;
  - single selected file in `folder1` -> `folder1`;
  - single selected file at root -> root;
  - multiple selected entries -> `selectionDirectoryPath`;
  - empty selection -> `selectionDirectoryPath` (root);
  - single selected directory not found in loaded tree -> `selectionDirectoryPath`.
- Manual checks (Electron dev run):
  1. Open a file: row highlighted solid. Click the editor/chat: highlight fades to pale. Click the row again: solid.
  2. Click a file row once, press Ctrl+C, click a folder, press Ctrl+V: file pasted into that folder (keyboard path). Repeat with native paste (Ctrl+V with OS-copied file): lands in same target.
  3. Select `folder1/file1.txt`, Ctrl+V: pastes into `folder1`. Select `folder1` (single directory), Ctrl+V: pastes INTO `folder1` (both key and native paths). Click root empty space, Ctrl+V: pastes at root.
  4. New File -> type name -> click anywhere: file created, opens. New Folder -> type name -> click anywhere: folder created and expanded. Empty name + click away: cancelled. Escape: cancelled. Name with `/`: error shown, input still focused and editable.
  5. Rename -> type new name -> click anywhere: renamed. Empty or unchanged name + click away: cancelled.
  6. Right-click a file -> Copy -> close menu: tree has focus (highlight solid), Ctrl+V pastes correctly. Right-click menu actions (Delete, Rename, Cut) also leave tree focus restored.
  7. Ctrl+C with focus in Monaco editor still copies text; Ctrl+V in chat input still pastes text.
  8. Cut dimming, Ctrl+A, Ctrl+Z, Delete dialog, drag-and-drop moves, and OS-file drag import still work.

## Rollout / recovery

- Single PR; no data migration, no IPC changes, no feature flag needed. If the paler token renders poorly in one theme, it is a one-line CSS override. Revert = revert the PR.

## Risks / mitigations

- `focusout` `relatedTarget` is `null` when focus leaves the window or moves to `body`; handled by the containment check (null -> unfocused), which matches VS Code.
- Re-subscribing the focus listeners when `contextMenuState` changes is cheap; alternatively read the menu state via ref to keep a stable subscription. No functional risk either way.
- Refocusing the tree on context-menu close must not fight the create/rename input autofocus (rAF-based) or the delete dialog's modal focus; tree refocus happens synchronously before those states render, so they win.
- Double-submit risk from unmount-triggered blur is already covered by `isSubmittingCreationRef` / `isSubmittingRenameRef`; the blur handlers must check them first.

## Acceptance criteria

- Selected/active entry is solid `brand-soft` while the explorer has focus and visibly paler when focus is elsewhere; reverts to solid on re-focus or when the context menu is open.
- Clicking a file row once, then pressing Ctrl+C, then Ctrl+V into any folder pastes the file there; no second click on the row required. Native OS-file paste uses the same target rules.
- Pasting with a single folder selected pastes into that folder; with a file selected pastes into its parent directory; after clicking root empty space pastes at root.
- Clicking away from a create/rename input commits it; Escape and empty names cancel; invalid names keep the input open and focused with an error shown.
- All existing explorer behaviors (reveal-on-open, cut dimming, multi-select, drag-drop, context menu, delete dialog, undo) remain functional; `npm run typecheck`, `npm run lint`, and `npm test` pass.

## Assumptions / open questions

- "Paler" intensity is a judgment call; 55% mix is the initial value, tuned after a visual check in both themes (the user can request a different intensity).
- Explorer-scoped shortcuts (not app-wide) were explicitly chosen by the user ("as close to vscode as possible").
- Context-menu Paste keeps its explicit right-click target rather than using the unified helper; behavior is already correct and VS Code-like.
