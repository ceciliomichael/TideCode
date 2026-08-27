# System tray and clean TideCode shutdown

## Goal
Keep TideCode running in the Windows system tray when the main window is closed, preserve Remote access and fast reopen, and make a true Quit shut down TideCode-owned background services cleanly so Windows packaging is not blocked by leftover processes.

## Changes
- Add an Electron tray icon with Open TideCode and Quit TideCode actions.
- Treat normal window close as hide-to-tray. Keep the BrowserWindow and renderer alive so Remote RPC remains available and reopening is instant.
- Reuse one show/focus path for tray clicks, app activation, and second-instance launches.
- Move cleanup to a guarded true-quit path instead of window-close/window-all-closed cleanup.
- Add a public graceful run-service shutdown request using the existing authenticated shutdown protocol, and invoke it during true desktop quit.
- Keep process cleanup targeted. Do not kill unrelated node.exe/electron.exe processes.
- Add bounded Windows retry behavior to generated build-output cleanup for short-lived file locks, while still surfacing persistent lock failures.

## Verification
- Run TypeScript typecheck and targeted tests for run-service/build behavior.
- Run the normal build.
- Inspect the Windows TideCode process tree before/after a true quit when practical.
- Run the Windows distribution command or the closest safe packaging verification available, and report any external process that still holds a lock.

## Scope
No new settings or startup-at-login behavior. No redesign of Remote. No global process-killing logic.
