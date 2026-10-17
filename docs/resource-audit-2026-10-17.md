# Electron RAM and CPU audit — 2026-10-17

## Conclusion and evidence limits

Optimize the current Electron application first. The clearest findings concern work performed without a visible consumer, concurrent Git subprocesses, invisible editor rendering, and retention of browser pages. Rewriting these paths in Rust while retaining their current lifecycle would leave substantial avoidable work in place.

This audit inspected the current working tree, sampled the existing installed Windows application, exercised read-only Git/workspace functions against this repository, and ran 21 focused existing tests. No application code was changed. The worktree already contains substantial uncommitted implementation changes; the installed executable reports version 1.4.21.0 and was last written at 12:28 on October 17. Source findings and installed-process measurements must therefore be treated as separate evidence. Their implementation parity has not been established.

The installed main process started at 13:42; the process sample was taken around 18:00. This is an existing session, not a cold-start or controlled-idle measurement. The user's visible panel state and background activity were not controlled. No installed app was stopped, restarted, repackaged, or attached to a debugger. Process memory does not establish a leak, and process CPU time does not identify a JavaScript stack.

## Observed installed-process resources

Windows CIM working-set and private-page counters, converted to MiB:

| PID | Role established from process arguments | Working set MiB | Private committed MiB |
| --- | --- | ---: | ---: |
| 28528 | Electron main | 221.8 | 215.1 |
| 26756 | GPU | 225.8 | 374.3 |
| 8900 | Utility | 59.0 | 18.9 |
| 4396 | Renderer | 62.0 | 25.6 |
| 6600 | Renderer | 403.0 | 367.6 |
| 15620 | Node run-service child | 240.6 | 316.8 |
| 26708 | Renderer | 651.0 | 554.9 |
| 16248 | Renderer | 145.5 | 52.8 |
| **Sum** | **Installed app and identified service child** | **2,008.7** | **1,926.0** |

Summed working sets can double-count shared resident pages. Private committed bytes are not equivalent to physical RAM. These figures exclude unrelated Node/development Electron processes observed on the machine. Renderer command lines establish process type but do not distinguish the main window, tray, browser guests, or DevTools; those labels require WebContents-to-PID mapping inside the app.

A roughly ten-second CPU interval over these processes showed:

| Role/PID | CPU seconds consumed | Equivalent percentage of one logical processor |
| --- | ---: | ---: |
| Main 28528 | 2.469 | 24.4% |
| Renderer 6600 | 2.703 | 26.7% |
| Renderer 26708 | 2.281 | 22.5% |
| GPU 26756 | 1.375 | 13.6% |
| Run service 15620 | 0.562 | 5.6% |
| Renderer 16248 | 0.031 | 0.3% |
| Other sampled processes | 0 | 0% |

Together this was about 93% of one logical processor, or 3.9% of the machine's 24 logical processors. It does not reproduce or disprove a larger intermittent CPU spike. Short-lived Git children are not included in this interval, so it also understates a subprocess-heavy workload. No claim of idle CPU usage is made.

## Findings

### 1. Full repository diff work continues with both panels closed — highest priority

`src/pages/ChatInterface.tsx:123` explicitly keeps full diff contents warm while side panels are closed. `useGitDiffSnapshot` defaults to `includeContent = true` and is called with polling enabled regardless of panel visibility. `ChatWorkspaceSidePanels.tsx` conditionally unmounts Diff and Source Control UI, but their shared hook is higher in the tree.

`src/hooks/useGitDiffSnapshot.ts:29` polls status every two seconds and requests full contents every fifth poll, approximately every ten seconds even if porcelain status is unchanged. Watcher events also trigger status followed by a forced full refresh. Other refresh paths include initial effects, branch/message changes in `useChatInterfaceController`, panel opening, and file actions. Some startup calls can overlap; request IDs ignore obsolete results but do not cancel their underlying Git work. The cache explicitly permits noncoalesced forced loads for mutation freshness, which is reasonable for correctness but leaves no overall execution bound across these triggers.

`electron/git/serviceDiff.ts` reads every changed file's HEAD, index, and working-tree text. It permits 24 concurrent file workers; each worker launches two `git show` subprocesses and one filesystem read. Thus a full snapshot can have up to 48 Git blob subprocesses outstanding, plus repository/status commands and other refreshes. Actual peak concurrency depends on scheduling and file count. Untracked files also pass through HEAD/index lookups that cannot normally return their content.

These complete strings cross IPC and `src/lib/chatDiffs.ts` then computes line summaries and content hashes in the renderer. A cache hit or snapshot equality check after loading does not prevent the preceding subprocess work, IPC transfer, or normalization. The renderer full-snapshot cache retains three repositories by entry count without a byte limit or inactivity expiry. This is bounded by count, not by memory volume.

Read-only timings against this checkout, with 114 changed files, three sequential samples per operation:

| Operation | Wall time samples, ms | Serialized return size |
| --- | --- | ---: |
| Porcelain status-only diff snapshot | 75 / 72 / 72 | 32,829 bytes |
| Commit status, including line statistics | 148 / 132 / 131 | 157 bytes |
| Branch state | 171 / 144 / 143 | 2,423 bytes |
| Full HEAD/index/worktree snapshot | 1,612 / 1,528 / 1,943 | 1,824,324 bytes |

Full-snapshot renderer normalization separately took 28 / 23 / 20 ms in Node. These are warm, small-sample timings, not startup measurements or browser-thread timings. An earlier single sample returned 1,823,254 bytes; files were changing during the session. The full snapshot held approximately 1.75 million source characters. This fixture demonstrates unnecessary work and process churn; it does not explain 2 GiB by itself.

**Recommendation:** use metadata when no consumer requires text; load text for an actual Diff/editor consumer, serialize refreshes with one pending invalidation, retain full snapshots within a byte budget and expire them after their final consumer closes. Preserve editor Git baselines: `useWorkspaceMonacoEditor.ts:166` uses HEAD text for decorations. Merely toggling `includeContent` from panel visibility would break that behavior. Source Control's file list should use status metadata; its scope projection currently assumes content and needs to distinguish unloaded content.

### 2. Collapsed tool results can still mount heavy views — highest priority

`src/components/chat/ToolInvocationBlock.tsx:219` renders `ToolDiffResult` whenever a diff presentation exists, regardless of its own collapsed state. `ToolDiffResult.tsx` hides its contents with CSS but still renders `DiffViewer`; that component can demand-load Monaco and create live diff editors/models. Grouped changes can create multiple editors.

Fenced/indented/raw-HTML code results can similarly render `ToolMarkdownResult` in a hidden premeasurement container. This parses Markdown and can mount Monaco code views despite the individual tool block being closed. Structured tool results are also parsed before the open-state rendering branch.

The existing tests explicitly require hidden premeasurement. They passed in this audit, confirming that this behavior is deliberate rather than a speculative leak. Static markup tests establish the render path, not actual native allocation sizes; runtime editor counts still need measurement.

There is an important boundary: the outer `WorkingBlock` renders its children only when open. Collapsing that entire group releases its child views; its behavior differs from collapsing an individual tool inside an open group. Plain-text/literal/terminal/image result bodies generally mount only when opened. The underlying result strings remain in the selected transcript in either case.

**Recommendation:** mount individual result bodies on expansion, preserve lightweight height estimates instead of rendering editors to measure them, and verify first-open layout/scroll behavior. Allow bounded model reuse after a real open. Do not silently replace this with eager hover prewarming for every row.

### 3. Startup Git prefetch fans out across saved projects — highest priority for launch spikes

`src/hooks/useInitializeChatHistory.ts:55` collects paths from every saved folder and conversation, then schedules both status and branch prefetch after about 1.5 seconds. Each helper deduplicates identical path strings, but launches all remaining paths through `Promise.allSettled` without a concurrency limit. Cache entry limits do not limit in-flight requests. Different paths within one repository may still cause repeated repository work.

Branch loading itself fans out into several Git commands. Commit-status loading (`electron/git/serviceHistory.ts`) invokes repository resolution, three changed-file commands, and two numstat commands. Opening an empty draft therefore does not imply that inactive saved repositories remain quiet. This is separate from the already-fixed global compaction-marker prefetch.

**Recommendation:** prefetch only the selected workspace and request other repositories when selected. Remove the now-unused all-project prefetch functions if that policy is adopted. This trades prewarmed inactive project switching for a quieter launch; active branch/count indicators must still initialize normally.

### 4. Browser hidden versus closed has different ownership

Before Browser is used, `initializedBrowserProjectKeys` is empty and no BrowserPanel guest exists. A local empty new tab also creates no webview. This feature alone is not evidence of a guest page at a pristine launch.

After visiting a website, the toolbar's Browser toggle in `ChatInterfaceContent.tsx:325` changes the view back to chat. `ChatConversationSurface.tsx:212` keeps the initialized BrowserPanel mounted under a hidden wrapper. The renderer retains up to two project sessions. All tabs within each session remain mounted, and there is no tab-count or memory budget. Inactive handling blurs pages and hides DevTools; it does not destroy guest WebContents or guarantee that page JavaScript/network/media stops. Chromium throttling is not a guarantee of zero CPU or RAM.

Closing the last browser tab follows a different path: it removes that project's initialized key, unmounting its guests. Project-session eviction also releases guests. Native DevTools close already destroys its view.

**Recommendation:** measure guest PIDs explicitly, then decide whether switching to chat should release pages or whether inactive tabs should unload after a short timeout. Preserve URL/history metadata, but be explicit that discarding pages loses unsaved form state and page execution state. This changes the documented live-session preservation policy and requires approval as part of that later change.

### 5. Independent polling and workspace rescans keep background work alive

In addition to diff polling:

| Path | Current cadence/trigger | Work |
| --- | --- | --- |
| `useGitCommit` | 10 s while document visible; Git events | Separate status and numstat commands |
| `useGitBranchState` | 30 s while document visible; Git events | Branches, remotes, ahead/behind metadata |
| `electron/workspace/explorerWatch.ts` | 1.5 s for subscribed workspace | Directory enumeration and stat calls for files in watched directories |
| `useWorkspaceRefactorCandidates` | Mount, focus, explorer changes; 250 ms debounce | Recursive ignored-aware traversal and reads/line counts of candidate files |
| `useChatContextUsage` | Events/focus and 60 s visible fallback | Context estimation; already serialized |
| `useChatSessionState` | 10 s | Shared-run reconciliation; probes do not by themselves start an absent service |
| `projectPathWatch` | 30 s | Saved project-path reconciliation |

Workspace directory polling has no in-flight guard, so a slow filesystem can overlap snapshots. Enumeration/stat concurrency is not capped within a snapshot. Native watchers are shallow (`depth: 0`), an intentional protection against recursive Windows handle growth. Do not remove fallback reconciliation without preserving nested-change correctness, and do not replace it with an unrestricted recursive watcher.

The refactor hook runs regardless of whether a suggestion is being examined. A single scan of this checkout took 215 ms wall time / 266 ms process CPU and returned 154 candidates in a standalone Node process. That is not a resident-memory measurement of the app. Large or frequently modified workspaces can amplify it. The hook coalesces refreshes during an active scan, but each refresh still recursively visits the project. Explorer notifications also invalidate TypeScript project caches and trigger context refresh consumers. Settings keeps ChatInterface mounted under an invisible wrapper; document visibility checks do not mean that the chat feature itself is visible.

**Recommendation:** one in-flight workspace snapshot, bounded stat concurrency, slower reconciliation appropriate to visibility/watcher coverage, and incremental refactor updates keyed to changed files. Initially preserve correctness and measure counts before choosing new intervals.

### 6. Long active transcripts still have no viewport rendering limit

`MessageList.tsx:749` maps all selected conversation render items into the DOM. The active transcript is intentionally exempt from the inactive-transcript retention budget. Old assistant messages, code blocks and expanded work can therefore scale with conversation length. Collapsing work groups helps, but does not window the transcript or remove its source data.

**Recommendation:** after the first lifecycle fixes, measure a long-chat fixture and add viewport rendering if it remains material. Preserve editing/revert anchors, compaction boundaries, copy/search behavior, and follow-latest positioning. DOM virtualization reduces mounted views; it does not independently solve full transcript loading or history parsing.

### 7. History is bounded in concurrency, but still parses full documents

Sidebar history listing now reads two conversations at a time, converting each to a summary. This reduces peak allocation pressure but still parses every conversation to list metadata. `electron/chat/history/eventStore.ts:157` reads/parses the entire canonical document and rewrites it as formatted JSON on updates. The document includes events and provider/model replay data. Context/marker/replay reads can require another full parse.

Shared-run progress persistence is debounced at 1.5 seconds or 4,096 delta characters, but persists full message arrays. During active runs, the service emits the growing current-run projection on a 32 ms coalescing timer and full conversation updates after persistence. This is active-run work, not a continuously firing idle projection timer. JSON/string copying and repeated transcript projection can become expensive as a run grows.

**Recommendation:** measure large histories and active streams separately. A metadata index/paged transcript and incremental stream updates are plausible later improvements. Storage-format changes require their own data-integrity/recovery plan; do not bundle them into a quick RAM fix.

### 8. Secondary baseline costs and existing protections

- Main IPC handlers eagerly import provider context-estimation runtime graphs. The detached run service also imports provider runtimes. This is a candidate for demand-loading and reducing duplicate initialization, not a measured byte attribution. Retain the run service's independent ownership of live CLI/remote work.
- The custom Windows tray popup preloads a BrowserWindow at startup. It adds a renderer even while invisible. Its first-open behavior is documented; measure its isolated cost before trading that behavior for lazy creation. The observed smallest renderer cannot be conclusively labeled the tray from command-line data alone.
- Monaco diff models retain a reference per mounted view. The 16-entry cache only evicts unretained models; mounted hidden views are protected and can exceed the nominal cap. Released models expire after 30 seconds. Workspace editor models have similar reference-based retention. Count limits should be supplemented by byte limits for inactive entries, not eviction of live/dirty editor state.
- Already present: lazy Monaco/settings/PDF/DOCX/Shiki loading, three recent inactive transcripts within a 16 MiB string estimate, demand-started run service, reference-counted/viewport PDF rendering, TypeScript source budgets, terminal output bounds and exited-session cleanup, completed-run expiry, bounded marker/highlight/Mermaid caches, and native DevTools destruction. These protections reduce particular failure modes; they do not establish a low app-wide baseline.
- Terminal shells/tasks and configured MCP subprocesses may have legitimate independent lifetimes. Closing a visual surface must not terminate active work as a side effect of a resource fix. The audit did not attribute resource usage to individual terminal/MCP children or establish a leak in those systems. The settings MCP hook already releases its workspace session on cleanup.

## Rust assessment after the Electron-first decision

| Candidate | Potential reason for Rust | Recommendation now |
| --- | --- | --- |
| Git snapshot/blob service | Fewer subprocesses, compact native-owned data, bounded file loading | Best later experiment if demand-driven/batched Git remains material; native Git is already doing the underlying work, so first reduce command count and transferred contents |
| Filesystem traversal/line scanning | Streaming buffers, compact indexing and less JS allocation | Consider only after on-demand/incremental scanning and measured large-workspace comparisons; ripgrep is already available for search |
| History indexing/replay storage | Bounded/paged records and less full-document allocation | Fix storage access patterns first; a Rust port of whole-document JSON parsing/rewriting retains the scaling problem |
| Pure diff computation | CPU-intensive calculation off the renderer thread | Measure first; a worker can address UI-thread blocking, while this checkout's repeated Git I/O cost is much larger than its normalization cost |
| Browser pages, Monaco instances, React/Markdown/DOM | Ownership/rendering inside Chromium | Rust backend code does not release these resources; fix lifecycle/windowing in Electron |
| Whole app shell/Tauri | A different host/runtime architecture | Outside the proposed work; no RAM savings assumed, and browser/native integration would need independent validation |

If a later Rust experiment is justified, replace one measured boundary and return compact results. Avoid maintaining the same whole source strings in Rust, Node, IPC payloads and renderer models. Neither a native addon nor a sidecar is inherently a memory win; a sidecar also adds a process and transport. Do not select a dependency or integration mechanism until the measured boundary is known.

Primary references: [Electron CPU measurement semantics](https://www.electronjs.org/docs/latest/api/structures/cpu-usage), [Electron WebContents lifecycle/background throttling](https://www.electronjs.org/docs/latest/api/web-contents/), [Tauri process model](https://v2.tauri.app/concept/process-model/), [NAPI-RS buffer ownership and conversion](https://napi.rs/docs/concepts/typed-array). Framework descriptions support these boundary distinctions, not app-specific savings estimates.

## Verification performed and outstanding

Executed 21 existing tests across Git snapshot loading/status merge, collapsed tool diff/Markdown premeasurement, Browser new tabs/history, and transcript retention: 21 passed, zero failed. Tests confirm current behavior, including the unwanted hidden-render paths; they do not certify that the resource problem is fixed. No implementation was made, so a production build/full-suite run was not used as a substitute for resource measurement.

Still required: matched packaged cold launches, WebContents/PID role attribution, CPU flame charts during the reported spike, main/renderer heap retainers, guest tab CPU/memory by visibility, large dirty workspaces, long transcripts/active streams, and repeated close/recovery cycles. Existing `docs/performance.md` contains earlier synthetic memory work; those numbers were not reproduced in this audit and are not current before/after results.

The proposed next implementation batch and its explicit file list are in [the Electron resource optimization plan](plans/electron-resource-optimization.md).
