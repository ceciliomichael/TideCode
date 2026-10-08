# TideCode memory investigation

## Scope and measurement

This pass covers the Electron application, renderer resource ownership, history loading, shared run-service, terminals, and editor caches. It preserves the worktree's existing lazy editor/settings/preview startup, bounded diff/highlight/Mermaid/checkpoint caches, event-driven Git refresh, and demand-started run-service changes.

Working set measures resident process memory; private bytes measure private committed allocations. JavaScript heap is only part of a renderer's memory: canvases, decoded images, native libraries, workers, Chromium, and GPU allocations matter too. Adding working sets can count shared pages more than once. Development also includes a separate Vite process.

The installed app was observed at approximately 609–613 MB working set and 452–474 MB private bytes during one quiet sample. Another sample briefly reached approximately 1,320 MB working set and 1,158 MB private bytes. That live spike was not attributed to a specific process before it ended; it is not a proven leak. Its installed executable has not been replaced by this source change.

The profiling runner uses a temporary home and Chromium profile, synthetic conversations, a separate service namespace and remote port. It does not read real transcripts or credentials, send AI requests, or force garbage collection. `built` runs the built renderer and main bundle in an unpackaged Electron host; it is not an installed-package benchmark. `dev` hosts the renderer through Vite while using the built main process. The driver's RSS is reported separately; in development it includes Vite.

## Confirmed problems and changes

| Area | Problem | Current ownership or limit |
| --- | --- | --- |
| PDF documents | Dropping cache entries did not destroy PDF workers/documents; pending loads could outlive their views. | Reference-counted leases; inactive expiry after 1 second; 3 documents and 32 MiB estimated source-string budget; active views are pinned. |
| PDF pages | Every page rendered immediately; prefetched bitmap images duplicated canvas storage; cancellation registered after rendering completed. | Pages within 400 px of the viewport render directly into one canvas, capped at 4 million pixels. Offscreen canvases release storage, and render tasks register before awaiting completion. No retained bitmap copies. |
| Chat transcripts | Every visited chat remained in renderer state. | Selected and running chats remain pinned; 3 recent inactive chats within 16 MiB estimated string storage. Eviction reloads persisted history on selection. |
| Syntax highlighting | Monaco created a second Shiki engine and eagerly loaded 39 languages. | One runtime shared with chat; asynchronous Monaco token factories load grammars when their language is used. Workspace theme is restored before Monaco tokenization. |
| TypeScript projects | Snapshot caches were bounded by count alone, and Monaco libraries survived the final editor closing. | Main: 6 requests/32 MiB source strings. Renderer: 4 requests/16 MiB. Libraries release 30 seconds after the final editor consumer closes. |
| Context estimates | Watcher/compaction/focus bursts could overlap full transcript estimates. | One active request plus one replaceable pending refresh across effect changes. Streaming context updates cancel pending work. |
| History listing | Concurrent reads and hydration retained every full transcript just to produce sidebar summaries. | Two reads/transforms at a time; each parsed transcript becomes a summary before the next batch. Primary/backup recovery semantics remain intact. |
| Startup compaction markers | Launch prefetched markers for every saved conversation concurrently, including when opening an empty draft. Each request read and parsed a full canonical history file. | Markers load only for the conversation being opened, with existing per-conversation request coalescing and compaction-event refresh. No global background marker prefetch. |
| Shared runs | Completed runs left sequence entries; untracked timers retained stream setup state. | Central tracked 60-second retention; expiry removes sequence, projection, follow-ups, and idle timers. Server shutdown clears timers and event subscriptions. |
| Service connections | Failed handshakes left sockets/partial receive buffers; simultaneous startup probes opened redundant connections. | Handshake failure destroys sockets; disconnect clears buffers and pending requests; probes coalesce; old socket callbacks cannot disconnect a newer socket. |
| Terminal broker | Unattached exited sessions and completed operation records persisted; synthetic owners never emitted destruction for legacy registry cleanup. | Unattached exited sessions expire after 5 minutes; completed operations retain at most 64 per session or 5 minutes; running operations and attached exited output are protected; owner cleanup emits on record release. |
| Other metadata | Branch paths and shared conversation metadata could accumulate. | 24 branch-cache keys including aliases; 128 shared conversation/mode/settled compaction entries with active work protected. |
| Browser DevTools | Closing docked DevTools hid its native view without releasing it. | Closed views are destroyed; transition and readiness listeners/timers clean up. |

Byte budgets estimate string storage, not total object/engine memory. Active documents, chats, operations, and compactions can exceed cache limits intentionally. Caches do not delete user history or attachments.

## Runtime findings

### Startup marker loading follow-up

Startup regression tests with 80 saved conversation summaries reproduced 80 marker requests in the previous implementation, including an empty-draft launch. Removing the global prefetch limits marker requests to the opened conversation; an empty-draft launch makes none. Preferred and fallback conversation restoration retain their marker preload, and the selected-conversation hook still refreshes markers after compaction events. This removes a known source of concurrent canonical-history parsing. The existing before/after memory figures below predate this follow-up; they do not measure its RAM savings or establish that it eliminates every startup spike.

The three new regression cases failed before the fix and passed afterward. All 15 focused history-workflow, marker-cache, and marker-view-state tests passed, as did `npm run typecheck`, `npm run build`, and `git diff --check`.

Synthetic history contains 32 conversations totaling approximately 31 MiB. The scenario waits at idle, lists history three times, switches 12 conversations, and records recovery. Early matched built runs showed the main process peak working set decreasing from approximately 508 MiB to 312 MiB. Renderer peaks and the time taken to return memory varied substantially between runs; a ten-second recovery sample was insufficient to establish steady idle memory. Longer recovery samples returned near the initial range in both versions. This is evidence of reduced allocation pressure, not a claim that all idle growth or every 1 GB spike is eliminated.

A development resource scenario opened, scrolled, and closed a twelve-page PDF three times. Two page canvases were allocated near either end of the document, each 1,632 × 2,112 pixels; all other canvases had zero backing dimensions. After each close, Chromium target discovery reported zero workers and the DOM had zero canvas backing pixels. The previous implementation allocated all twelve page canvases and additionally cached rendered copies: the new viewport policy removes that duplication and scales raster memory with visible pages rather than document length. The visible canvases in this fixture occupied approximately 26.3 MiB of raw RGBA storage, versus 157.8 MiB for twelve page canvases alone, before considering the old additional bitmap copies.

The Monaco runtime scenario loaded only `typescript`, `ts`, `cts`, and `mts`, and returned syntax tokens through its registered token provider. Switching the shared highlighter to chat's light theme preserved Monaco's dark-theme tokens on the next tokenization. A separate Node measurement of the old 39-language configuration used approximately 29 MB more RSS than loading TypeScript alone; this is an isolated engine measurement, not an app-wide savings guarantee.

### Final built comparison

Windows, Electron 43.7.5, approximately 31 MiB synthetic history, 12 seconds of idle sampling and 40 seconds of recovery; no forced GC. Measurements vary with GC and other machine activity. The following is one before/after pair, not a statistical benchmark:

| Measurement | Baseline | Final source build |
| --- | ---: | ---: |
| Main-process peak working set over the scenario | 503.8 MiB | 300.3 MiB |
| Highest sampled aggregate working set during history listing | 1,048.1 MiB | 957.4 MiB |
| Highest sampled aggregate working set during chat switching | 1,335.6 MiB | 1,212.7 MiB |
| Aggregate working set after 40 seconds of recovery | 753.1 MiB | 740.5 MiB |
| Main-window JavaScript heap after recovery | 56.6 MiB | 50.6 MiB |
| Highest sampled initial idle aggregate working set | 780.5 MiB | 816.0 MiB |

The main-process peak decreased approximately 40%. Initial idle working set did **not** improve in this pair, and renderer peak working set was approximately 647–648 MiB in both versions. The clearer gain is lower history-loading allocation pressure and explicit release/bounded retention of previously unowned resources.

Reports for this pair and the final resource checks were saved under the temporary directories `tidecode-memory-profile-f9GU2x`, `tidecode-memory-profile-f8LlcJ`, and `tidecode-memory-profile-nG0Jc3`. They contain only synthetic profiling data. The built profiling driver peaked near 54 MiB RSS. The development profiling host peaked near 671 MiB RSS while serving the PDF/Monaco scenario; it includes Vite and profiling code and is excluded from Electron app totals. That is a resource-scenario measurement, not a stock `npm run dev` idle baseline.

## Reproduction

Build before profiling the main process:

```powershell
npm run build
node scripts/profile-memory.mjs --mode built --seconds 40 --recovery-seconds 40
node scripts/profile-memory.mjs --mode dev --seconds 40 --recovery-seconds 40
node scripts/profile-memory.mjs --mode dev --resources --history-mib 0 --seconds 8 --recovery-seconds 10
```

Run profiles sequentially for comparable results. Each run prints its temporary `report.json` path and retains its synthetic fixtures there for inspection. The report contains Electron process metrics in KiB, renderer/main/driver memory in bytes, scenario failures, and resource checks. The resource scenario mounts the actual PDF component and exercises the actual Monaco configuration; it does not send an AI request or open a real workspace terminal. Development source must be present under `--root`. A baseline built directory can be supplied with `--root` after copying `dist`, `dist-electron`, `dist-cli-runtime`, `public`, and `package.json` before rebuilding.

For a quiet-launch measurement without large transcripts, add `--history-mib 0`. An empty synthetic history still includes 32 minimal conversations. Compare the same Electron version, scenario, window visibility, and recovery duration. Track the main window, hidden tray renderer, GPU process, utilities, and any separately running shared service when investigating a real installation.

## Verification and limits

The final full Node test suite passed with 1,595 passes, zero failures, and one existing Electron native-focus integration test skipped (1,596 tests total). Focused tests cover PDF leases/expiry/replacement races, transcript retention, serialized estimation, demand-loaded grammars, history concurrency, TypeScript caching and library disposal, failed socket handshakes, run retention, abort listener removal, and real PTY session release. Type checking, production build, and `git diff --check` passed. Final built and development resource reports contain no scenario failures.

The real Windows PTY cleanup test prints a `node-pty` helper `AttachConsole failed` error after the shell exits. The parent test still exits successfully and verifies removal of broker and legacy session records. No dependency patch was introduced for that native helper behavior.

The work does not establish a universal idle RAM target. It does not exercise paid/live provider traffic, prolonged real terminal workloads, or the installed executable after repackaging. Native Browser DevTools transitions are checked by code review and the build; the existing native-focus test remains skipped. GPU working set and V8 heap capacity can remain elevated after resources are released. Do not treat a single Task Manager number, short recovery sample, or forced-GC result as proof of a leak or of its elimination.
