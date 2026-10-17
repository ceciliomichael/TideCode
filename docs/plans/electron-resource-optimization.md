# Electron resource optimization plan — approved implementation

The approved batch is implemented. Current behavior, three matched before/after CPU/RAM runs, twenty-cycle model cleanup and >60-second recovery, passing focused checks and pre-existing full-suite failures are recorded in `../performance.md`. The future follow-ups at the end remain outside this batch. `useChatInterfaceController.ts` and the existing status-merge tests did not need changes: orchestration gating and new scoped-metadata tests cover their existing callers.

## Revised scope: immediate sending and preserved UX

This revision follows the user's request to improve speed and RAM/CPU usage while retaining existing UX. It puts desktop Send responsiveness first; the steps and additional files here supplement the original structure and change list below. The worktree was clean when this follow-up investigation began. Earlier uncommitted changes cannot be assumed to remain uncommitted or to explain the installed app's lag.

### Confirmed Send bottleneck

`useChatMessages.ts` enables `optimisticRemotePresentation` only for the remote browser. Desktop `persistAndStreamMessage` waits for `persistUserTurn` before displaying a new user bubble. That path loads/creates the conversation, creates a checkpoint, reads workspace instruction/environment context and saves the message. Remote already presents a stable-ID bubble before these operations complete. This establishes a visibility dependency on I/O; it does not measure the share of delay attributable to each operation.

### Revised implementation order

1. **Display an accepted desktop submission immediately.** Generalize the existing optimistic path across desktop and remote, using the final message IDs. Show the bubble and clear the submitted composer before awaiting persistence, then reconcile saved attachments/context onto that bubble. Keep validation and send/queue gates. Provider execution still waits for successful checkpoint/context/history persistence.
2. **Make pending-send reconciliation safe.** A failed save removes only that submission and restores its draft only while it owns the composer. Never overwrite text typed since Send or another chat's draft. Cover cancellation, edits, fresh conversations, batched sends and navigation. Extract focused presentation helpers from the large send workflow instead of adding transport-specific branches or retaining the old remote-only switch.
3. **Apply the original Git/background-work fixes.** Gate full text loading on Diff/editor consumers, bound execution/retention, and eliminate all-project startup Git fanout. Preserve statuses, editor baselines and post-mutation freshness. Capture the baseline before changing these behaviors.
4. **Remove hidden tool-body rendering with interaction checks.** Preserve headers/counts, collapse controls, keyboard access, copy behavior and scroll anchoring. Use lightweight size estimates and the existing loading presentation when a requested heavy view initializes. Measure first-open latency/layout; do not compensate by mounting every hidden editor again.
5. **Verify Send latency and resource behavior.** Extend synthetic scenarios to measure Send-to-bubble paint separately from saving/provider start. Use blocked persistence and failure/race tests, then measure idle CPU/RAM and repeated panel/tool cycles. Run focused tests, typecheck, build and applicable full tests, reporting artifact type and measurement limits.

### UX constraints and tradeoffs

- Preserve Browser sessions/tabs and unsaved page state: no page eviction or Browser lifetime-policy change in this batch.
- Preserve dirty editor contents, selections, focus, panel widths, actions, attachments, queues, cancellation, editing/revert and follow-latest behavior.
- Required saving/checkpoint work remains before provider execution. Immediate presentation is not evidence that a turn has already saved successfully.
- Treat first-open loading and scroll continuity as verification requirements. Bring back a revised plan if preserving them needs a material architectural/scope change.
- A renderer blocked by other synchronous work cannot paint immediately. Measure actual paint rather than equating a state update with visibility.

### Additional expected structure and explicit file list

The visible +/− badge also consumes snapshot totals while panels are closed. Compact native Git statistics preserve those totals without file bodies. This directly supports the approved count/UX requirement: `electron/git/serviceDiff.ts` is modified to attach statistics to both snapshot modes; `electron/git/diffStats.ts` is created for NUL-safe numstat parsing and bounded streaming counts for untracked/unborn files; `tests/gitDiffStats.test.ts` is created to verify line totals, rename parsing, binary/untracked files and unborn repositories. No IPC schema changes are needed because per-file counts already exist in the contract.

`tests/codex/gitServiceDiff.test.ts` is also modified so its metadata expectations retain text-file line counts while still checking that binary rows and full snapshots behave correctly.

These files supplement the full original tree/list below; no new dependency, data migration or provider protocol is expected.

```text
src/hooks/
  useChatMessages.ts
  useChatComposerState.ts
  useChatSessionState.ts
  chatMessageSendWorkflow.ts
  chatMessageSendTypes.ts
  chatOptimisticSendPresentation.ts
tests/
  chat/chatMessageSendWorkflow.test.ts
  chatOptimisticSendPresentation.test.ts
AGENTS_LEARNING.md
```

| Action | File | Responsibility/change |
| --- | --- | --- |
| Modify | `src/hooks/useChatMessages.ts` | Remove remote-only optimistic configuration and its unused runtime import |
| Modify | `src/hooks/useChatComposerState.ts` | Expose current composer ownership/revision so asynchronous settlement cannot overwrite newer typed text or attachments |
| Modify | `src/hooks/useChatSessionState.ts` | Apply pending-send rollback as a functional message update against the latest queued React state, preserving incoming updates |
| Modify | `src/hooks/chatMessageSendWorkflow.ts` | Present before persistence; retain save/provider ordering and ownership-safe reconciliation/rollback |
| Modify | `src/hooks/chatMessageSendTypes.ts` | Remove remote-only presentation switch; describe necessary pending-send ownership inputs |
| Create | `src/hooks/chatOptimisticSendPresentation.ts` | Focused optimistic message construction and reconciliation/rollback decisions, separate from persistence/provider orchestration |
| Modify | `tests/chat/chatMessageSendWorkflow.test.ts` | Desktop/remote display before blocked I/O; draft/edit/batch reconciliation, failed save, cancellation/navigation and no premature provider start |
| Create | `tests/chatOptimisticSendPresentation.test.ts` | Minimal ownership/race cases catching removal of another turn, duplicate IDs or restoration over newer composer text |
| Modify | `AGENTS_LEARNING.md` | Record explicit UX-preservation requirement for this optimization work |

The already-listed profiler and architecture/design/performance documents also cover Send latency, shared immediate presentation and measured results. This revision supersedes the original statement that the first batch only addresses Git, profiling and tool rendering.

### Additional acceptance criteria

- With persistence deliberately blocked, an existing desktop chat and a fresh desktop draft already show exactly one submitted user bubble. Saving retains the same message ID.
- A failed save never starts the provider, leaves no phantom saved turn, and does not erase newer composer text or alter a newly selected chat.
- Edit/revert/cancel and queued/batched sends retain their behavior, attachments and mention maps.
- Target a visible bubble within 100 ms of an accepted ordinary Send in an isolated idle desktop fixture; report median/p95 and actual paint evidence. This is a verification target, not a guarantee under machine-wide overload.
- Browser preservation remains unchanged. No user-state loss is accepted as a RAM optimization.

### Baseline verification before implementation

The five focused send/history/gate/queue/edit test files produced 37 passes and one failure. `tests/codex/chatHistoryWorkflows.test.ts` fails `revert helpers rewind the clicked message and every later user turn` at its `revertedChatMode` assertion: actual `agent`, expected `plan`. The failure also reproduces when run alone. No application code had changed. Record it separately from optimization regressions; do not silently alter mode/revert behavior as unrelated cleanup. If it prevents validating required Send/revert behavior, investigate and bring back the smallest justified scope adjustment.

## Intended result and boundary

Reduce RAM pressure and CPU work at launch and while optional surfaces are closed, retaining Electron and existing user workflows. The user approved this revised batch. Implementation and verification results are recorded in `docs/performance.md`; no architecture migration is included. The supporting findings are in `docs/resource-audit-2026-10-17.md`.

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
      MarkdownRenderer.tsx
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
| Modify | `src/components/chat/MarkdownRenderer.tsx` | Remove the code-block detector made obsolete by removing hidden premeasurement |
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
