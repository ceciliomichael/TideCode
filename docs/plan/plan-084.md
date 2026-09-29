# Plan 084: Source Control, Editor Freshness, Browser Shortcut, and Multi-File Paste Fixes

## Status

Implemented, including the added multi-file drag/drop batching fix.

Automated verification passed:

- focused tests: 17/17
- `npm run typecheck`
- `npm run build`
- `git diff --check`

The GUI-specific manual regression steps below remain the final runtime checks.

## Follow-up findings and fixes

### Windows clipboard multi-selection still collapsed to one file

Runtime verification against the actual Windows clipboard showed that the native
`System.Windows.Forms.Clipboard.GetFileDropList()` contains all selected files
while TideCode still receives only the focused/last file.

The remaining weak point is the long-lived PowerShell clipboard reader. Its
stdout protocol shares request state across reads and depends on chunk-delimited
`EOF` parsing, so a delayed/partial response can fall back to Electron's
single `FileNameW` entry.

Follow-up implementation:

- replace the persistent PowerShell clipboard process with one isolated STA
  Windows Forms query for each ambiguous Windows clipboard read;
- emit the complete file-drop list as JSON and parse it atomically;
- keep Electron's direct multi-file result as the fast path;
- retain the direct single path only when the native Windows query genuinely
  fails or returns no file-drop list.

### Git change detection can wait on full diff work or the 10-second fallback

The Source Control watcher intentionally uses `depth: 0` on Windows to avoid
one native watcher per repository directory. Nested external edits can therefore
miss the watcher and wait for the current 10-second renderer poll.

Even when an explicit TideCode save notification arrives quickly, the renderer
currently waits for a full-content diff refresh before updating the visible
change list.

Follow-up implementation:

- on source-control change events, load status-only Git metadata first and merge
  it into the visible snapshot immediately;
- then refresh full diff contents in the background;
- reduce the source-control event debounce while still coalescing bursts;
- shorten the visible-window fallback poll so nested external edits are detected
  materially sooner without enabling recursive Windows filesystem watching;
- keep the existing 220 ms editor autosave cadence unchanged.

Follow-up verification passed:

- native Windows clipboard probe returned all three selected Explorer files;
- focused regression tests: 17/17;
- `npm run typecheck`;
- `npm run build`;
- `git diff --check`.

## Goal

Fix five independent desktop workflow bugs without changing unrelated Source Control, editor, browser, or Explorer behavior:

1. After initializing a local Git repository that already contains files, Source Control must show the Commit action as soon as Git reports those files as changed/untracked instead of temporarily or incorrectly showing Publish Branch.
2. Recreating a file at the same path must show the new on-disk contents in the code editor instead of content retained by an old Monaco model.
3. Ctrl+R must not reload TideCode or the embedded website when keyboard focus is outside the browser content.
4. Pasting multiple files copied from Windows Explorer into TideCode Explorer must import every copied file, not only the focused/last-selected file.
5. Dragging or pasting multiple external files into TideCode Explorer must update the Explorer once after the batch completes instead of visibly adding files one by one.

## Findings

### 1. Repository initialization can expose an empty Git diff snapshot

The primary-action selector itself is already correct:

- working-tree changes => Commit
- clean repository with no remote => Publish Branch
- clean repository with outgoing commits => Sync Changes

The failure is earlier in the refresh path.

Immediately after `git init`, `SourceControlNoRepoView` asks the shared Git UI controller to refresh branch state and diff state. At that moment, `useGitDiffSnapshot` can still be executing with the previous `hasRepository = false` render state. Its `refresh` function currently refuses to query Git when that captured value is false and replaces the snapshot with an empty one.

The branch refresh then discovers the new repository. For the interval where repository state is true but the diff snapshot is still empty, Source Control selects Publish Branch even though files exist.

The Git backend already detects untracked files correctly with `git ls-files --others --exclude-standard`. The fix should therefore be in renderer refresh gating, not in Git status parsing or the primary-action selector.

### 2. Monaco retains models for the same file path

Workspace file synchronization already:

- watches Explorer changes;
- polls open files;
- reads ordinary text files directly from disk;
- updates tab content when external contents change;
- closes tabs when a file disappears.

The stale value comes from the editor layer.

`WorkspaceMonacoEditorView` uses `keepCurrentModel`, and `workspaceMonacoModelCache.ts` intentionally keeps released Monaco models alive for 30 seconds. If `go.mod` is deleted and recreated quickly, the same Monaco URI can reuse the old model containing `module hello` even after the workspace tab has read `module miniverse` from disk.

The fix is to make the current workspace-tab value authoritative when a retained model is reused.

### 3. The main Electron window still accepts the default reload accelerator

The embedded browser already contains browser-specific reload handling. It also blurs an inactive Electron webview.

However, the main Electron `BrowserWindow` only hides the menu bar. It does not disable the default Electron menu accelerators. Therefore Ctrl+R can still be handled as a main-window reload while focus is in TideCode outside the webview. Reloading the TideCode renderer also causes the embedded browser surface to reload.

The fix should disable menu shortcut handling for the main renderer while leaving browser-specific keyboard handling to the browser surface itself.

### 4. Windows clipboard direct reads can be lossy for multi-selection

TideCode first asks Electron clipboard buffers for copied file paths and only invokes the Windows Forms `Clipboard.GetFileDropList()` PowerShell fallback when the direct result is empty.

For Windows Explorer multi-selection, Electron can expose a direct `FileNameW`/similar representation containing only the focused item, even though the native file-drop list contains all selected files.

Because TideCode currently treats any non-empty direct result as complete, a one-file direct result such as `3.txt` prevents the native fallback from discovering `1.txt`, `2.txt`, and `3.txt`.

The native fallback should therefore confirm ambiguous one-file direct results. Clearly multi-file direct results can remain on the fast path.

### 5. External multi-file imports notify Explorer after every file

`submitImportEntries` deliberately imports external paths sequentially. Sequential copying is useful because destination-name conflict handling stays deterministic, but every `importWorkspaceEntry` call currently emits its own Explorer change notification.

That means a three-file drop can produce three watcher refreshes and visibly reveal the files one by one even though the user performed one batch operation.

The copy operations should remain sequential, but intermediate Explorer notifications should be suppressed so only the last import publishes the batch change. The existing final tree reload can then render the completed batch in one update.

## Planned implementation

### 1. Make forced Git diff refresh independent of stale repository UI state

Update `useGitDiffSnapshot` so an explicit refresh can query the Git backend whenever a workspace path exists, even if the current React render still says `hasRepository = false`.

Expected behavior:

1. user initializes repository;
2. existing refresh callback is invoked;
3. forced diff refresh calls `git:getDiffs` instead of short-circuiting on stale UI state;
4. backend sees the newly initialized repository and existing untracked files;
5. diff snapshot receives those files;
6. Source Control resolves its existing primary-action logic to Commit.

Repository-state props will still control continuous polling/watcher behavior so a normal non-repository workspace does not gain unnecessary background Git work.

No change is planned to `sourceControlPrimaryAction.ts` because its behavior is already correct.

### 2. Synchronize reused Monaco models with authoritative tab content

Update `useWorkspaceMonacoEditor` so the mounted/current Monaco text model is synchronized when its text differs from the current workspace-tab `value`.

Requirements:

- only replace the Monaco model value when it is actually stale;
- do not create a feedback loop through `onChange`;
- preserve normal typing behavior;
- retain the existing delayed Monaco model cache for fast tab switching;
- do not disable `keepCurrentModel` globally just to fix this case.

This keeps the performance benefit of retained models while preventing old text from winning over freshly read disk contents.

### 3. Prevent main-window Ctrl+R from acting as an Electron menu reload

Update application-window setup so the main TideCode renderer consumes its own primary-modifier + R reload accelerator before Electron can reload the TideCode shell.

Expected behavior:

- focus in chat/editor/Explorer/terminal UI + Ctrl+R => TideCode shell does not reload and browser page does not refresh;
- focus in the actual browser surface => browser-specific reload behavior remains responsible for Ctrl+R;
- existing normal DOM/editor keyboard shortcuts remain available.

The interception is scoped to the main TideCode renderer webContents. Electron browser webviews remain separate guest webContents, so browser-owned reload behavior remains available when the webview itself has focus.

### 4. Confirm ambiguous Windows clipboard results with the native file-drop list

Update `WindowsClipboardReader.readFiles()`:

1. read direct Electron clipboard file paths first;
2. if the direct result contains multiple paths, return it immediately;
3. if the direct result contains exactly one path, query the existing Windows Forms file-drop fallback;
4. if the fallback returns file paths, use the complete native list with duplicates removed;
5. if the fallback is empty/unavailable, retain the direct single path;
6. if the direct result is empty, keep using the fallback as today.

Tradeoff:

- true single-file paste may wait briefly for the native fallback confirmation;
- multi-file correctness is more important than returning an incomplete list;
- the existing persistent PowerShell process remains in place, so this does not introduce a new subprocess architecture.

The IPC handler must route Windows reads through this centralized reader before accepting a direct single-path result, otherwise the handler itself can bypass the confirmation logic.

### 5. Defer Explorer tree refreshes during an external import batch

Keep external imports sequential for deterministic collision-safe destination naming, but mark the Explorer tree as being inside a batch import while the loop runs.

`submitImportEntries` will:

1. mark the Explorer batch-import ref active;
2. import each source path in its existing order;
3. let file-system/watcher events accumulate as a pending Explorer refresh rather than rendering intermediate states;
4. clear the batch-import ref;
5. force one Explorer reload after the complete batch, including after a partial failure.

This applies to both drag/drop and external clipboard paste because both already share `submitImportEntries`.

## Planned project structure

Only the following existing implementation files and this plan are expected to change:

```text
tidecode/
├── docs/
│   └── plan/
│       └── plan-084.md                              # created
├── electron/
│   ├── clipboard/
│   │   └── windowsClipboardReader.ts               # modify
│   ├── ipc/
│   │   └── registerWorkspaceIpcHandlers.ts          # modify
│   └── window/
│       └── createApplicationWindow.ts               # modify
└── src/
    ├── components/
    │   └── workspaceExplorer/
    │       ├── workspaceExplorerPanel/
    │       │   ├── useWorkspaceExplorerPanelState.ts # modify
    │       │   ├── useWorkspaceExplorerTransfers.ts  # modify
    │       │   └── useWorkspaceExplorerTree.ts       # modify
    │       └── workspaceFileEditor/
    │           └── useWorkspaceMonacoEditor.ts      # modify
    └── hooks/
        └── useGitDiffSnapshot.ts                    # modify
```

No new dependency, schema, IPC contract, or persistent setting is expected.

## File-by-file changes

### Create

- `docs/plan/plan-084.md`
  - Record the verified causes, implementation boundaries, affected structure, and verification plan.

### Modify

- `src/hooks/useGitDiffSnapshot.ts`
  - Remove the stale `hasRepository` short-circuit from explicit workspace diff refreshes.
  - Keep repository-state checks around background polling/watching.
  - Preserve forced-refresh cache bypass behavior.

- `src/components/workspaceExplorer/workspaceFileEditor/useWorkspaceMonacoEditor.ts`
  - Reconcile a reused Monaco model with the latest `value` supplied by the workspace tab.
  - Avoid writes when model text is already current.
  - Keep the existing retained-model lifecycle.

- `electron/window/createApplicationWindow.ts`
  - Disable Electron menu-shortcut processing for the main TideCode renderer so Ctrl+R does not reload the app outside the browser surface.
  - Leave browser-owned reload handling intact.

- `electron/clipboard/windowsClipboardReader.ts`
  - Treat a one-path direct Windows clipboard result as potentially incomplete.
  - Confirm it through the existing native file-drop fallback.
  - Prefer the complete fallback list when available, otherwise preserve the direct path.
  - Keep the current fast path for direct results that already contain multiple paths.

- `electron/ipc/registerWorkspaceIpcHandlers.ts`
  - Route Windows clipboard file reads through `WindowsClipboardReader` so an ambiguous single direct path cannot bypass native multi-selection confirmation.

- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerTransfers.ts`
  - Keep multi-file imports sequential while holding the Explorer batch-import ref.
  - Always perform one final forced reload after the batch finishes or partially fails.

- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerPanelState.ts`
  - Own the batch-import ref and pass it to the tree and transfer hooks.

- `src/components/workspaceExplorer/workspaceExplorerPanel/useWorkspaceExplorerTree.ts`
  - Defer normal watcher-triggered reloads while an external import batch is active.
  - Clear any deferred reload marker when a forced reload is performed.

### No expected changes

- `src/components/sourceControl/sourceControlPrimaryAction.ts`
  - Existing decision logic is already correct.

- `electron/git/serviceDiff.ts`
  - Existing Git status collection already includes untracked files.

- `electron/clipboard/windowsDropFilesParser.ts`
  - Existing CF_HDROP parser already supports multiple paths.

- test files
  - These fixes are isolated integration/UI behavior with existing adjacent unit coverage. The exact regressions are directly reproducible, so verification will combine existing focused tests, type checking, and the four manual regression cases below.
  - If implementation reveals a logic seam that requires a new testable contract, the plan must be revised before adding extra files.

## Verification

### Automated

Run focused existing tests:

```powershell
npm test -- tests/sourceControlPrimaryAction.test.ts
npm test -- tests/codex/gitDiffSnapshotCache.test.ts
npm test -- tests/windowsDropFilesParser.test.ts
npm test -- tests/components/workspaceExplorer/workspaceExplorerDragUtils.test.ts
```

Then run:

```powershell
npm run typecheck
npm run build
```

### Manual regression 1: repository initialization

1. Open a non-Git workspace containing files.
2. Open Source Control.
3. Click Initialize Repository.
4. Do not wait for the periodic Git poll.
5. Confirm the existing files immediately appear as untracked/changed.
6. Confirm the primary action is Commit, not Publish Branch.
7. Confirm Publish Branch remains available only after the working tree is clean and the repository has no remote.

### Manual regression 2: recreated file at the same path

1. Run `go mod init hello`.
2. Open `go.mod` and confirm it shows `module hello`.
3. Delete `go.mod`.
4. Run `go mod init miniverse`.
5. Reopen `go.mod` immediately, within the Monaco retention window.
6. Confirm the editor shows `module miniverse`, not the retained `module hello`.
7. Repeat once with another value to confirm the result is not timing-dependent.

### Manual regression 3: Ctrl+R browser focus

1. Open TideCode's browser and navigate to a page whose reload is easy to observe.
2. Move focus to chat, Explorer, or the code editor.
3. Press Ctrl+R.
4. Confirm TideCode does not reload and the browser page does not refresh.
5. Focus the actual browser surface.
6. Press Ctrl+R.
7. Confirm browser reload behavior still works when the browser owns focus.

### Manual regression 4: Windows Explorer multi-file paste

1. Create `1.txt`, `2.txt`, and `3.txt` outside TideCode.
2. Select all three in Windows Explorer, with `3.txt` as the focused/last-clicked item.
3. Press Ctrl+C.
4. In TideCode Explorer, choose a destination folder and press Ctrl+V.
5. Confirm all three files are imported exactly once.
6. Repeat with one copied file to confirm single-file paste still works.
7. Repeat with two files to confirm multi-file direct/fallback behavior is stable.

### Manual regression 5: multi-file drop/paste renders as one batch

1. Drag three or more small files from Windows Explorer into a TideCode Explorer folder.
2. Confirm the files appear together after the batch completes rather than one by one.
3. Repeat using Ctrl+C/Ctrl+V from Windows Explorer.
4. Confirm collision suffix behavior still works when a destination filename already exists.

## Acceptance criteria

- Repository initialization with existing files leads directly to a usable Commit action after the explicit refresh, without waiting for background polling.
- Clean local repositories without a remote still show Publish Branch.
- Recreated files never display stale retained Monaco text when fresh disk content has been loaded.
- Ctrl+R outside browser focus does not reload TideCode or its embedded page.
- Ctrl+R with browser focus still performs browser-owned reload behavior.
- Windows Explorer multi-selection paste imports every copied file.
- Single-file external paste continues to work.
- External multi-file drag/drop and paste update the Explorer once after the complete batch instead of visibly adding entries one at a time.
- No unrelated Source Control, Monaco caching, browser persistence, or Explorer transfer behavior is changed.
- Focused tests, typecheck, and build pass.
