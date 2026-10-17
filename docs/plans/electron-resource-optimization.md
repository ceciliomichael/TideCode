# Electron resource optimization plan — proposed, awaiting approval

## Intended result and boundary

Reduce RAM pressure and CPU work at launch and while optional surfaces are closed, retaining Electron and existing user workflows. This is a proposal, not an implemented change or an approved architecture migration. The supporting findings are in `docs/resource-audit-2026-10-17.md`.

The first batch deliberately addresses the most concrete findings: measurement gaps, full Git snapshots without consumers, inactive-project startup Git fanout, and hidden tool-body premeasurement. Browser page eviction, transcript virtualization, incremental workspace indexing, history storage and Rust work remain separately scoped follow-ups after measuring this batch.

## Step-by-step implementation

1. **Establish attributable before/after measurements.** Extend the existing isolated profiling runner to retain CPU counters and map all WebContents to OS PIDs, types and visibility, including guests and DevTools. Record renderer heap, DOM/canvas/model counts where available, with synthetic fixtures and no real URLs/content. Add scenarios for startup, a dirty repository with closed/open panels, and collapsed/open tool results. This separates Electron baseline, retained pages and JavaScript work instead of relying on a summed Task Manager number. Capture the baseline before changing behavior.
2. **Make full Git snapshots depend on actual consumers.** Keep metadata for branch/count/file status UI. Request full content only while the Diff view or a workspace editor that needs a Git baseline consumes it. Source Control rows consume status metadata; selecting a file activates Diff loading. Keep the current aggregate snapshot API for real content consumers in this first batch; per-file blob loading is a later refinement. Wire demand at the ChatInterface orchestration boundary and preserve existing workspace-editor HEAD decorations. Closing the last consumer stops full refreshes and expires retained contents. Add a 16 MiB estimated source-string budget alongside the existing three-entry cache cap; do not cache oversized snapshots after use. These are initial implementation limits to verify, not measured app-wide budgets.
3. **Bound Git refresh execution and background work.** For a repository/request kind, keep one active refresh and at most one pending fresh refresh. Mutation/watch invalidations must get a post-invalidation read instead of reusing an older snapshot. Stale requests must not repopulate a cache after its consumer/workspace generation expires. Remove the unconditional ten-second full-content refresh while there is no content consumer. Keep metadata reconciliation and nested-edit correctness. Do not launch all saved repositories at startup; initialize the selected workspace and fetch other repositories when selected. Remove helper paths made obsolete by that change.
4. **Mount tool bodies when expanded.** Replace invisible Monaco/Markdown premeasurement with a lightweight initial size estimate. Parse/render the result body on expansion, dispose the view on collapse, and retain only the existing bounded model reuse after an actual open. Preserve tool headers, diff count summaries, decision cards, and outer WorkingBlock behavior. Verify first-open layout and scroll anchoring because the old premeasurement exists to make opening feel immediate.
5. **Verify both correctness and resource behavior.** Run focused tests, typecheck/build, and sequential matched profiles. Compare packaged launches separately from unpackaged built and Vite runs. Repeat open/close cycles and wait past the existing 30-second editor-model grace period. Publish baseline versus changed results, including failures, startup CPU, full Git load counts in the synthetic harness, process/model counts, peak/private memory and recovery. Update project knowledge with measured results; do not claim a percentage reduction in advance.

## Expected affected structure after this batch

```text
scripts/
  profile-memory.mjs
src/
  pages/ChatInterface.tsx
  hooks/
    useGitDiffSnapshot.ts
    useChatInterfaceController.ts
    useInitializeChatHistory.ts
  lib/
    gitDiffSnapshotCache.ts
    gitBranchStateCache.ts
    gitStatusCache.ts
    chatDiffs.ts
  components/
    sourceControl/SourceControlPanel.tsx
    chat/
      ToolInvocationBlock.tsx
      ToolDiffResult.tsx
      ToolMarkdownResult.tsx
tests/
  codex/
    gitDiffSnapshotCache.test.ts
    gitDiffStatusMerge.test.ts
    gitStatusCache.test.ts
    toolDiffResultPremeasure.test.tsx
    toolMarkdownResultPremeasure.test.tsx
  resourceDemand.test.ts
ARCHITECTURE.md
DESIGN.md
docs/
  performance.md
  resource-audit-2026-10-17.md
  plans/electron-resource-optimization.md
```

## Explicit file-by-file change list

All paths are relative to the repository root. No dependency, storage schema, migration, Rust crate, IPC contract or packaging change is expected in this batch.

| Action | File | Responsibility/change |
| --- | --- | --- |
| Modify | `scripts/profile-memory.mjs` | CPU/process ownership samples and synthetic Git/tool lifecycle scenarios; expand the existing scenario module rather than introducing a second profiling runner |
| Modify | `src/pages/ChatInterface.tsx` | Express actual full-content consumer demand and pass it to the diff hook, accounting for workspace editors as well as right panels |
| Modify | `src/hooks/useGitDiffSnapshot.ts` | Consumer lifecycle, gated full refreshes, request generations and serialized reconciliation |
| Modify | `src/hooks/useChatInterfaceController.ts` | Route branch/message/mutation refreshes through the gated scheduler; preserve action freshness |
| Modify | `src/hooks/useInitializeChatHistory.ts` | Stop all-saved-project startup status/branch prefetch; retain selected-workspace initialization |
| Modify | `src/lib/gitDiffSnapshotCache.ts` | Byte-aware inactive snapshot retention/expiry and bounded, generation-safe refresh scheduling |
| Modify | `src/lib/gitBranchStateCache.ts` | Remove all-project prefetch helper once its sole startup caller is removed |
| Modify | `src/lib/gitStatusCache.ts` | Remove all-project prefetch helper once its sole startup caller is removed |
| Modify | `src/lib/chatDiffs.ts` | Avoid content calculations for explicit unloaded status snapshots; preserve scoped change metadata |
| Modify | `src/components/sourceControl/SourceControlPanel.tsx` | Build staged/unstaged file rows from metadata without requiring renderable file strings |
| Modify | `src/components/chat/ToolInvocationBlock.tsx` | Gate result parsing and heavy body mounting on expansion; retain lightweight header summaries |
| Modify | `src/components/chat/ToolDiffResult.tsx` | Remove hidden premeasurement body rendering |
| Modify | `src/components/chat/ToolMarkdownResult.tsx` | Remove hidden premeasurement body rendering |
| Modify | `tests/codex/gitDiffSnapshotCache.test.ts` | Catch overlapping execution, lost post-mutation refresh, obsolete cache repopulation, byte-budget and expiry failures |
| Modify | `tests/codex/gitDiffStatusMerge.test.ts` | Catch loss of staged/unstaged/rename/conflict status while content is unloaded or later hydrated |
| Modify | `tests/codex/gitStatusCache.test.ts` | Remove expectations for deleted all-project prefetch helper if present; preserve ordinary status caching behavior |
| Modify | `tests/codex/toolDiffResultPremeasure.test.tsx` | Replace current eager-render requirements with collapsed-body absence and unchanged header assertions |
| Modify | `tests/codex/toolMarkdownResultPremeasure.test.tsx` | Replace current eager code-render requirements with collapsed-body absence and expanded-content coverage where the harness supports it |
| Create | `tests/resourceDemand.test.ts` | Minimal meaningful coverage of consumer decisions: closed panels/no editor, Source Control metadata, Diff, editor baseline and startup saved-project policy; exercise runtime effects in the Electron profiling scenarios |
| Modify | `ARCHITECTURE.md` | Record implemented demand/refresh/cache ownership after verification |
| Modify | `DESIGN.md` | Record approved on-demand tool/diff behavior and loading/scroll tradeoff |
| Modify | `docs/performance.md` | Append reproducible matched CPU/RAM results and limits without replacing historical measurements |
| Modify | `docs/resource-audit-2026-10-17.md` | Annotate addressed findings and link measured implementation results |
| Modify | `docs/plans/electron-resource-optimization.md` | Record actual completed scope, checks and any separately approved deviations |

The existing test filenames mentioning premeasurement can remain for this focused batch; renaming them provides no resource benefit. Test additions must catch a concrete lifecycle/freshness failure, not assert implementation text alone. If meaningful consumer tests require additional production structure or a broader interface change, revise the plan before implementing that expansion.

## Acceptance criteria

- An empty-draft or restored-chat launch does not query Git for every inactive saved workspace.
- With Diff closed and no editor needing HEAD content, initial effects, timers, message changes and watcher events perform **zero full-content Git snapshot loads**. Source Control continues to show correct statuses and actions from metadata.
- Opening Diff loads current contents; reopening after a file edit or stage/unstage cannot display a cached pre-mutation state. Editor decorations continue comparing against the correct Git baseline.
- At most one content read per repository is active within the renderer scheduler, plus one queued refresh. A request started before closure/workspace change cannot refill expired cache state. This is a renderer bound; multiple independent desktop/remote clients remain a separately measured concern.
- Collapsed individual diff/Markdown tools create no result-body Monaco editors. Expansion works, collapse disposes views, and unreferenced cached models release after their existing grace period. Decision requests and diff-count headers remain correct.
- Source-content cache byte/count limits are verifiable; active consumer data remains available even if it exceeds an inactive cache budget.
- No progressive growth in live guest/editor/model counts across 20 matched open/close cycles; memory is sampled after 60 seconds of recovery without forced GC. V8/native allocator capacity need not return to an identical number for the lifecycle test to pass.
- No lost nested-worktree updates, staged/unstaged correctness, edits, attachments or saved history. Run focused Git/editor/retention tests, then `npm run typecheck`, `npm run build`, and the applicable full Node suite before declaring implementation complete.
- Record distributions from at least three sequential baseline and changed runs of the same artifact type. Review CPU seconds and tail spikes as well as retained RAM. Choose an app-wide RAM target from the attributable baseline; do not promise a universal target now.

## Follow-up decision order after this batch

1. **Workspace polling/refactor scanning:** stop overlapping directory snapshots; measure and reduce 1.5-second stat polling while preserving shallow-watcher coverage; replace full refactor rescans with incremental or demand-based updates. Current owners are `electron/workspace/explorerWatch.ts`, `electron/workspace/explorer.ts`, and `src/hooks/useWorkspaceRefactorCandidates.ts`. A focused scanner extraction is appropriate if substantial logic is changed. Exact files/tests belong in that follow-up plan after baseline counts are available.
2. **Browser page lifetime:** compare never-opened, local-new-tab, visible website, hidden website and last-tab-close states. Decide whether to unload on switching to chat or after inactivity. Current owners are `ChatInterfaceContent.tsx`, `ChatConversationSurface.tsx`, `BrowserPanel.tsx`, and native guest setup. Changing live-page preservation loses unsaved page state; seek approval for that explicit behavior change.
3. **Long transcripts and streams:** measure DOM/editor counts and projection payloads, then scope transcript windowing or incremental projections. These have separate scrolling/editing/reconnection risks and are not part of the first batch.
4. **Startup/main/service baseline:** measure provider import graphs, tray renderer, existing service and remote host individually. Demand-load expensive graphs if demonstrated; retain CLI/remote/background-run ownership.
5. **History data access or Rust:** only after measurements distinguish storage, computation and Chromium retention. Prefer improving data access over porting the same unbounded operation. Any storage change or native boundary gets a separate complete implementation/data-integrity plan.

No approval is implied for these follow-ups by approval of the first batch.
