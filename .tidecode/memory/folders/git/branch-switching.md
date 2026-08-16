# TideCode Git Branch Switching and Refresh Concurrency

## Branch switching contract

The chat branch selector is a thin UI over `useGitBranchState`; branch-switch responsiveness depends on Git refresh concurrency, not dropdown rendering. `checkoutGitBranch` in `electron/git/serviceBranch.ts` still performs the local checkout and existing remote fast-forward synchronization. Do not remove that synchronization merely to make the selector appear faster.

## Refresh concurrency

Source-control filesystem events can arrive in large bursts while Git rewrites a worktree during checkout. `electron/git/sourceControlWatch.ts` must use a true trailing debounce: each new event resets the pending timer, so consumers receive one consolidated change event after the burst settles instead of refresh notifications every debounce interval.

`src/lib/gitBranchStateCache.ts` treats `forceRefresh` as bypassing cached data, not bypassing an already-running repository read. Concurrent forced branch-state refreshes for the same workspace must share the active request so watcher and polling activity cannot accumulate Git subprocesses.

`src/hooks/useGitBranchState.ts` suppresses watcher/poll refreshes while branch creation or checkout is active. Starting a branch mutation invalidates earlier refresh request IDs and clears stale loading state; the branch state returned by the mutation becomes authoritative for that transition. This prevents a refresh started before checkout from overwriting the newly selected branch.

## Verification

Regression coverage for forced refresh coalescing is in `tests/gitBranchStateCache.test.ts`. Branch checkout remote-sync behavior remains covered by `tests/codex/gitBranchCheckoutSync.test.ts`, and branch-state behavior by `tests/codex/gitBranchState.test.ts`.

Verified against the Git branch selector, source-control watcher, branch-state hook/cache, and checkout service on August 16, 2026.
