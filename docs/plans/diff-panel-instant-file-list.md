# Diff panel: immediate cached file list

Status: approved by the user and implemented. This is a focused correction to the Electron optimization UX, without a Rust migration or a new Git transport.

## Confirmed cause

`useGitDiffSnapshot` resets its snapshot to the full-content cache when content demand starts. That cache is deliberately released on closing the last content consumer. The still-available status cache is ignored, so reopening clears the file list until the full repository diff arrives. `ChatInterface` also forces a read when the right panel opens, which can queue another full read behind the hook initialization. Full-mode status reconciliation drops new files until content arrives. Expanded rows currently assume their contents are available.

## Implementation steps

1. Keep the lightweight cached status list visible when entering full-content mode. Retain only metadata after closing; when a workspace has no cached status, fetch metadata independently so its list need not await all file bodies. Guard workspace/request identity so one project never displays another project's changes. Retain normal background status freshness and full-content release.
2. Render new metadata rows as soon as status arrives while preserving already-loaded bodies. Let expanded metadata rows retain their header, actions and expansion state and show the existing preview-loading presentation until hydration. Never create an empty Monaco diff from missing contents. Scoped metadata counts must not present invented zero totals; display accurate available counts or defer unavailable scope-specific counts until hydration.
3. Coalesce the panel-open forced refresh with a read already in progress. Preserve explicit mutation invalidations, which still need a read after the mutation. Keep the existing aggregate full-content API and editor baselines; per-file loading remains outside this correction.
4. Verify a blocked full-content request cannot hide a cached list on first open or reopen, metadata-only rows never mount Monaco, hydration preserves expansion, switching projects cannot show stale rows, and opening does not cause a duplicate full read. Run focused Git/cache/scope tests, TypeScript and the production build. Exercise the actual hook in the existing isolated Electron interaction harness with delayed content, reporting observed results and any unverified visual behavior.

## Expected affected structure

```text
src/
  hooks/useGitDiffSnapshot.ts
  pages/ChatInterface.tsx
  components/chat/
    ConversationDiffFileItem.tsx
    DiffViewer.tsx
  lib/chatDiffs.ts
  components/workspaceExplorer/WorkspaceFileTabsPanel.tsx
tests/
  codex/gitDiffStatusMerge.test.ts
  diffPanelMetadataRows.test.tsx
  resourceDemand.test.ts
scripts/profile-memory.mjs
docs/plans/diff-panel-instant-file-list.md
ARCHITECTURE.md
DESIGN.md
AGENTS_LEARNING.md
```

## Explicit file changes

| Action | File | Responsibility |
| --- | --- | --- |
| Modify | `src/hooks/useGitDiffSnapshot.ts` | Use status cache while full content loads; independently refresh cold status; reconcile new metadata rows; retain workspace/request guards and memory release |
| Modify | `src/pages/ChatInterface.tsx` | Coalesce panel-open refresh without weakening mutation freshness |
| Modify | `src/components/chat/ConversationDiffFileItem.tsx` | Pass content availability to previews and include availability in memo comparison; preserve headers/actions and expansion |
| Modify | `src/components/chat/DiffViewer.tsx` | Reuse the existing loading view while requested file contents are unavailable; gate Monaco mounting |
| Modify | `src/components/workspaceExplorer/WorkspaceFileTabsPanel.tsx` | Required editor consumer guard: metadata can label tabs but must not supply a missing-text baseline or mark tracked files new |
| Modify | `src/lib/chatDiffs.ts` | Preserve content-availability markers through scope projection and avoid misleading pending scope counts |
| Modify | `tests/codex/gitDiffStatusMerge.test.ts` | Verify prompt metadata insertion with loaded-body preservation |
| Create | `tests/diffPanelMetadataRows.test.tsx` | Verify visible pending rows and loading presentation without mounting Monaco |
| Modify | `tests/resourceDemand.test.ts` | Cover pending metadata scope behavior |
| Modify | `scripts/profile-memory.mjs` | Extend actual-hook demand scenario with blocked content, reopen, workspace isolation and request-count checks |
| Create | `docs/plans/diff-panel-instant-file-list.md` | Record this plan, approval and verification results |
| Modify | `ARCHITECTURE.md` | Record implemented separation between list availability and preview hydration |
| Modify | `DESIGN.md` | Record implemented list continuity and per-preview loading behavior |
| Modify | `AGENTS_LEARNING.md` | Record the user's requirement that reopening Diff should retain its known file list |

## UX and tradeoffs

A cached list appears immediately and refreshes in the background; external changes can make it briefly stale. A genuinely cold project still needs its first Git status read, but that list must not wait for full text retrieval. Expanded previews can briefly show loading because retaining all closed-panel bodies would restore the memory cost. Preserve staging/discard actions, scopes, expansion state and existing editor consumers. No dependency, IPC schema, Browser lifetime, persistence or provider changes are planned.

## Verification results

- 26 focused tests passed: pending-row presentation, status merging/count updates, Git snapshot lifecycle and mutation freshness, scope projection, native Git staged/unstaged/rename/conflict behavior, ordering and editor line-status/tab utilities.
- TypeScript passed. Production build passed, including Electron main/preload and CLI outputs. Build reports existing chunk-size/dynamic-import warnings.
- Isolated Electron/Vite interaction run: `%TEMP%/tidecode-memory-profile-nzAdox/report.json`, zero failures. With full contents deliberately blocked, cached headers remained visible, expanded pending previews mounted no Monaco, reopening preserved the list and expansion, a cold project's metadata appeared before contents, and late old-project results never appeared under the new project. Coalescing the panel-open refresh produced one full read, with no queued duplicate. Closed panels made six metadata reads and zero full reads over eleven seconds.
- That same run also passed the existing Send/startup/tool checks: ten immediate-send samples, zero inactive-project startup Git requests, twenty tool cycles with two models while open and zero after expiry.
- Required editor guard was discovered while tracing existing consumers: metadata rows also reach workspace tabs. The tabs boundary now excludes metadata-only rows from editor baselines and avoids labeling a tracked file new merely because its HEAD text is pending. Existing editor/status tests pass; no live visual gutter comparison was performed.
- These are synthetic interaction checks of the real hook and file-row components, not a packaged-app end-to-end latency or new RAM benchmark. A cold project still needs its first Git status read. Full repository preview contents are still read when demanded and released when the last content consumer closes. Installed TideCode was not replaced.

## Follow-up: immediate scoped line counts

Status: approved by the user, implemented and verified. The user requires the +/− counts to appear with the cached rows, rather than waiting for preview hydration. The previous implementation intentionally deferred Staged/Unstaged counts because metadata currently carries only combined HEAD-to-worktree counts; using those for either scope would be incorrect for partially staged files.

### Steps

1. Read separate HEAD-to-index and index-to-worktree line statistics through bounded repository-wide Git numstat commands. Attach these compact counts to both metadata and full snapshots. Retain combined totals for the existing overall badge and reuse bounded streaming counts for untracked files. Handle unborn repositories, renames, deletions, binary files and conflicted paths explicitly. This adds native statistics work, not retained preview bodies or per-file Git process fanout.
2. Carry the scoped counts through normalization, status reconciliation and equality checks. Project the selected scope from the supplied statistics so counts do not wait for text or change merely because previews hydrate. Preserve existing content-based projection for conversation/tool diffs that have no Git scope metadata.
3. Display accurate cached counts on collapsed and expanded rows immediately. Preserve independent preview loading, last-consumer content release, row actions, expansion and project isolation.
4. Verify distinct staged/unstaged counts before full text resolves, partial staging whose edits cancel in the overall diff, count-only changes, zero counts, renames, binaries, untracked and unborn files. Extend the existing actual-hook interaction scenario to assert scoped counts remain visible during blocked preview loading and reopening. Run focused native/renderer tests, TypeScript and the production build. Record results and limits here.

### Expected affected structure

```text
electron/git/
  diffStats.ts
  serviceDiff.ts
src/
  types/chat/git.ts
  lib/chatDiffs.ts
  hooks/useGitDiffSnapshot.ts
  components/chat/ConversationDiffFileItem.tsx
tests/
  gitDiffStats.test.ts
  resourceDemand.test.ts
  diffPanelMetadataRows.test.tsx
  codex/gitDiffStatusMerge.test.ts
scripts/profile-memory.mjs
docs/plans/diff-panel-instant-file-list.md
ARCHITECTURE.md
DESIGN.md
AGENTS_LEARNING.md
```

### Explicit file changes

All files below will be modified; no new file, dependency, transport endpoint or migration is planned.

| File | Change |
| --- | --- |
| `electron/git/diffStats.ts` | Read scoped native counts and handle rename/untracked/unborn/binary/conflict cases without retaining bodies |
| `electron/git/serviceDiff.ts` | Attach combined and scope-specific statistics to Git file snapshots |
| `src/types/chat/git.ts` | Describe compact staged/unstaged line counts in the existing snapshot payload |
| `src/lib/chatDiffs.ts` | Preserve and project scoped counts independently of content availability |
| `src/hooks/useGitDiffSnapshot.ts` | Reconcile and compare scoped counts so scope-only changes refresh the UI |
| `src/components/chat/ConversationDiffFileItem.tsx` | Show metadata-backed counts immediately while previews continue loading independently |
| `tests/gitDiffStats.test.ts` | Real-repository coverage of scoped totals and partial staging, including edits cancelling in the combined diff |
| `tests/resourceDemand.test.ts` | Metadata scope projection, including zero counts and separate scoped totals |
| `tests/diffPanelMetadataRows.test.tsx` | Counts visible in both collapsed and expanded pending rows without mounting Monaco |
| `tests/codex/gitDiffStatusMerge.test.ts` | Scope-only count updates reconcile without dropping loaded text |
| `scripts/profile-memory.mjs` | Assert scoped counts during blocked content loading and reopening |
| `docs/plans/diff-panel-instant-file-list.md` | Approval, implementation and verification record for this follow-up |
| `ARCHITECTURE.md` | Document implemented scoped metadata statistics |
| `DESIGN.md` | Replace the deferred-count behavior with immediate metadata-backed counts |
| `AGENTS_LEARNING.md` | Record that immediate Diff rows include their accurate +/− counts |

A cold repository still needs its initial status/statistics read. Cached counts can briefly reflect the previous status snapshot while background refresh runs. Correct scoped totals require extra compact native Git statistics; they must not be obtained by loading all preview bodies or displaying combined counts under the wrong scope.

### Follow-up verification results

- All 29 focused tests passed, covering native statistics, scoped projection, metadata row rendering, scope-only reconciliation, snapshot scheduling/release, rename/conflict handling and ordering. The native fixtures cover cancelling staged/unstaged changes with zero combined totals, a staged rename later deleted from the working tree, partial staging before the first commit, and ordinary unstaged-only changes.
- TypeScript and the final production build passed, including Electron/CLI output. Existing build warnings about bundle sizes and dynamic imports remain.
- The final Electron/Vite interaction report is `%TEMP%/tidecode-memory-profile-IQCymR/report.json`, with zero failures. With full file responses blocked, the real hook and file-row components displayed unstaged +7/−3 and staged +4/−1 from metadata; counts survived hydration and reopening. A change to staged counts alone was detected while combined totals stayed unchanged. Cold-project counts also appeared before preview bodies. Opening still produced one full read; eleven seconds closed produced six metadata reads and no full reads. The unchanged renderer was exercised before the final backend-only optimization below; native tests and the production build cover that optimization.
- The same successful run completed twenty tool cycles with two models while open and zero after expiry, followed by the recovery interval. An earlier broad run passed the Diff/count checks but timed out in the tool lifecycle scenario after an observed development-page reload; its report is `%TEMP%/tidecode-memory-profile-52nr4e/report.json`. No causal claim about that reload is made. The repeat run completed with files left unchanged.
- Statistics work remains bounded to repository-wide commands. Repositories without staged changes reuse the combined numstat for unstaged counts, avoiding a redundant native diff in that common case. Missing scopes do not spawn statistics reads. Partially staged repositories can require up to three parallel compact numstat reads; no per-file statistics subprocess or retained source body was added.
- These synthetic interaction and native-repository checks do not establish a packaged-app latency or RAM percentage. A cold project still needs its first status/statistics read. The local source/build is updated; installed TideCode was not replaced.
