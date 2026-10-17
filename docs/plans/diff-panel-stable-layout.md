# Diff file rows: stable header layout

Status: approved by the user, implemented and verified.

## Intended result and findings

File names, icons, +/− counts and action buttons should occupy the same positions in collapsed, expanded-loading and expanded-loaded Diff rows. Keep cached rows/counts immediate and heavy previews on demand. Opening a preview normally moves subsequent rows down; this change does not promise to know an unseen preview's final height before its contents arrive or to freeze rows below it.

The collapsed row in `ConversationDiffFileItem.tsx` and the expanded header in `DiffViewer.tsx` duplicate markup but differ in flex/grid layout, text offset (`top-px` only in the collapsed row), count shrinking, action-column reservation and expansion border handling. The virtual list estimates collapsed rows at 49px although its 28px buttons plus 24px padding and border imply 53px with the current theme. Browser measurements will establish the final geometry. Global CSS already hides native scrollbars; introducing a new scrollbar gutter is not justified by these findings.

## Steps

1. Extract the existing filename/icon/toggle header into one focused component used by the lightweight collapsed row and DiffViewer. Preserve generic DiffViewer appearances for chat/tool callers; apply one explicit height, baseline, padding, reserved border and action-column width to conversation Diff rows in every state. Keep filename truncation, nonshrinking counts, hover/focus chevrons, tooltips, keyboard access and file actions.
2. Match the virtual list's collapsed height to that concrete row geometry. Use the known collapsed height immediately rather than a stale expanded measurement when collapsing; keep expanded preview measurements separate so switching states cannot place rows using the other state's cached height. Do not pre-render hidden Monaco views to measure headers.
3. Add meaningful header regression checks and extend the existing Electron interaction harness to compare actual filename/count/button rectangles before expansion, during blocked content and after hydration/collapse. Cover narrow panels, long filenames, Staged and Unstaged actions, opening/reopening and a list above the virtualization threshold. Verify the clicked header remains anchored; report ordinary movement below expanding previews separately.
4. Run focused row/Git/virtualization tests, TypeScript, the production build and the isolated interaction run. Record observed geometry and limits, and update project knowledge with the implemented behavior.

## Expected affected structure

```text
src/components/chat/
  DiffFileHeader.tsx
  DiffViewer.tsx
  ConversationDiffFileItem.tsx
  VirtualizedConversationDiffFileList.tsx
tests/
  diffPanelMetadataRows.test.tsx
scripts/profile-memory.mjs
docs/plans/diff-panel-stable-layout.md
ARCHITECTURE.md
DESIGN.md
AGENTS_LEARNING.md
```

## Explicit file changes

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `src/components/chat/DiffFileHeader.tsx` | Shared filename/icon/toggle/slots markup; conversation-row geometry constants/classes colocated with the header they describe |
| Modify | `src/components/chat/DiffViewer.tsx` | Use the shared header; support the conversation header's stable action slot/geometry without changing other callers' default layout |
| Modify | `src/components/chat/ConversationDiffFileItem.tsx` | Use the same header in collapsed and expanded paths, preserving lightweight collapsed rendering and existing actions/prewarm callbacks |
| Modify | `src/components/chat/VirtualizedConversationDiffFileList.tsx` | Use the exact collapsed row height and distinguish expanded measurements from collapsed geometry |
| Modify | `tests/diffPanelMetadataRows.test.tsx` | Assert consistent header structure/geometry configuration, accessible controls, immediate counts and no pending Monaco rendering |
| Modify | `scripts/profile-memory.mjs` | Compare actual DOM rectangles across loading/expansion/collapse, narrow/long-path cases and virtualized rows |
| Create | `docs/plans/diff-panel-stable-layout.md` | This plan, approval and verification record |
| Modify | `ARCHITECTURE.md` | Record implemented shared header and measurement ownership |
| Modify | `DESIGN.md` | Record stable header positioning and normal preview expansion behavior |
| Modify | `AGENTS_LEARNING.md` | Remember the user's requirement that clicking/opening Diff should not shift header text or controls |

No dependency, Git payload, persistence, Browser lifetime or model-retention policy changes are planned. Actual Git count changes may change the number of digits; previews may change height when real contents arrive. Verification targets accidental header shifts with unchanged file metadata.

## Implementation and verification

- Added the shared `DiffFileHeader` and opted conversation rows into a fixed 52px header with identical baseline, reserved separator and 72px action slot across states. Generic tool/chat DiffViewer callers keep their default sizing. File names truncate while counts retain their width; collapsed views remain lightweight.
- Collapsed rows explicitly reserve 53px including their outer separator. The virtual list uses that same constant immediately on collapse and only measures expanded rows, using a layout effect for the initial measurement and ResizeObserver for later preview sizes.
- The browser check caught a real display-scaling issue: a nominal 1px border rendered as 0.8 CSS pixels, producing a 52.8px collapsed row and a mismatch with 53px virtual offsets. Fixing the total row height removed the mismatch. The initial broad report (`%TEMP%/tidecode-memory-profile-pErQFr/report.json`) and diagnostic report (`%TEMP%/tidecode-memory-profile-6DCb31/report.json`) record the failed pre-fix assertion; their unrelated Send/Git/startup/tool checks completed before geometry testing.
- Final geometry report: `%TEMP%/tidecode-memory-profile-1bkFwC/report.json`, zero failures. Eight cases combine 320px/850px widths, Staged/Unstaged actions and 2-file/30-file lists. A long first-row filename exercises truncation. Actual x/y/width/height rectangles for the header, filename, icon, added/removed counts and first action button showed **0px maximum change** on expansion with blocked contents, hydration into a real Monaco editor, collapse and reopening. The second row's collapsed offset also matched 53px before expansion and after collapse.
- The profiling script now accepts `--interaction-scenario exerciseDiffHeaderLayout` to reproduce this focused scenario without repeating unrelated fixtures. It loads the application's real stylesheet and waits for fonts before measuring. Run: `node scripts/profile-memory.mjs --mode dev --interactions --interaction-scenario exerciseDiffHeaderLayout --history-mib 0 --seconds 0 --recovery-seconds 0`.
- All 37 focused tests passed (row metadata/header, diff viewer, collapsed tool demand, variable virtualization, Git counts/status/cache/order). TypeScript and the final production build passed, including Electron and CLI output. Existing bundle-size/dynamic-import build warnings remain.
- These are real DOM measurements in an isolated Electron/Vite fixture at the tested display scale, not a packaged-app visual comparison or a proof that lower rows never move. Preview expansion and real content-height changes still move later rows; genuine metadata updates can change the number of count digits. No Browser/session policy, Git API, model-retention policy or hidden editor premeasurement changed. The installed application was not replaced.
