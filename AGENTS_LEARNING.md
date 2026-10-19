# Durable project knowledge

- The user confirmed on 2026-10-18 that TideCode durable memory should be per chat, with Markdown stored inside each chat's existing history as the single source of truth, rather than a separate project DURABLE.md file. This storage choice is confirmed; implementation still requires approval of the concrete plan.

- For the RAM/CPU optimization work discussed on 2026-10-17, the user prefers improving the current Electron app first. Rust is an option to evaluate against measured remaining bottlenecks, not an approved migration.
- Resource/speed optimizations must retain existing UX and user state. The user specifically wants desktop Send to display the bubble immediately; preserve editing, queues, cancellation, attachments and navigation when making presentation optimistic.
- Distinguish current checkout behavior, installed application measurements, and historical profiling reports. Do not attribute installed-process resource use to a source change without establishing artifact parity.

- Opening/reopening Diff must show its known changed-file list immediately; refresh metadata and hydrate previews without clearing the list while full file contents load. This includes accurate Staged/Unstaged +/− counts alongside file names; do not defer counts until preview contents arrive.

- Diff file headers should already occupy their final positions before clicking: preserve filename/count/control alignment across collapsed, loading and expanded states, while retaining on-demand heavy preview rendering.

- The user wants Browser to open as a right sidebar with optional workspace fullscreen, replacing other right-side panels when selected. Browser's new-tab/fullscreen controls and Diff's fullscreen control should match the terminal controls and use the shared Tooltip. Panel resizing must stop before chat contents overlap and must keep the layout stable during drag and release.
