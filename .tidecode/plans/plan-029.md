---
status: implementation_started
---

# Terminate TideCode before Windows installation and use a comfortable default window

Make the Windows TideCode installer reliably continue when an existing TideCode desktop process is still running in the background, including when it is minimized to the tray, and make the desktop window open at a comfortable non-maximized default size that works across common screen sizes.

## Repository findings

- The Windows installer is an NSIS installer configured in `electron-builder.json5` and customized through `installer/installer.nsh`.
- `installer/installer.nsh` already has a `customInit` hook that runs early in installation, detects existing per-user/per-machine installations, configures the firewall rule, and handles the `isUpdated` relaunch path.
- The packaged executable name is `TideCode` / `TideCode.exe`, configured in `electron-builder.json5`; the NSIS installer itself is a different process, so process matching can be limited to TideCode's executable name.
- The app supports tray/background operation and performs asynchronous cleanup during quit in `electron/main.ts`; simply closing a window is not sufficient. The installer should request termination and then wait for the process to disappear before file replacement.
- Existing update plumbing uses `electron-updater` in `electron/updates/autoUpdateService.ts`, which invokes the branded NSIS installer through `quitAndInstall(false, true)`. The installer-side behavior is therefore the correct common place to solve both manual installs and in-app updates.
- `electron/window/createApplicationWindow.ts` currently sizes the initial window to the entire primary display work area and then calls `win.maximize()` during `ready-to-show`, making every normal launch effectively maximized.
- Existing tests cover update-request parsing, but there is no current NSIS installer behavior test or window-bounds policy test.

## Planned changes

### 1. Modify `installer/installer.nsh`

Add a narrowly scoped helper macro/function used from `customInit` that:

1. Detects whether a running process matches `${APP_EXECUTABLE_FILENAME}` (normally `TideCode.exe`), rather than matching a broad name such as Electron.
2. Requests termination of the matching TideCode process, including child processes if needed for the app's background/tray process tree.
3. Waits in a bounded loop for the process to exit and for the executable to become replaceable.
4. Treats “process not found” as success, so a normal fresh install is unaffected.
5. If the process cannot be terminated or remains locked after the timeout, stops the installation with a clear installer error instead of continuing into a partial or corrupted upgrade.
6. Runs before files are replaced, while preserving the existing install detection, firewall setup, and `${isUpdated}` relaunch logic.

The implementation should use the Windows process utilities already available to NSIS/electron-builder rather than adding a runtime dependency. It should be idempotent and safe when no TideCode process is running. Avoid terminating the NSIS setup process or unrelated TideCode CLI processes unless repository evidence confirms they use the same executable and must also be closed for an install.

### 2. Modify `installer/installer.nsh` messaging/flow as needed

Make the installer visibly communicate that it is closing TideCode before continuing, using the existing native NSIS detail/status UI. Preserve silent/non-interactive update behavior where `${isUpdated}` is true; an in-app update should close the desktop process and continue without requiring a user click.

### 3. Modify `electron/window/createApplicationWindow.ts`

Replace the current full-work-area initial bounds and unconditional `win.maximize()` behavior with a responsive default window policy:

- Start at a comfortable desktop size such as approximately 1280×820, subject to the existing minimum size of 960×680.
- Center the window within the primary display work area.
- Clamp the default width and height to the available work area with sensible margins, so it fits on smaller laptops while using a useful amount of space on larger monitors.
- Do not maximize or enter fullscreen automatically on first launch.
- Preserve normal user controls so the user can maximize, restore, resize, or fullscreen manually.
- Keep the existing `show: false` and `ready-to-show` flow, but call `show()` without calling `maximize()`.
- Keep the current minimum dimensions unless verification shows the selected default cannot fit at the smallest supported screen size.

The exact constants should be named and kept local to the window creation module. This is a default-launch change, not a new persisted window-layout feature; avoid adding settings or migration unless existing code already persists window bounds.

### 4. Add/adjust verification coverage

Because NSIS execution is Windows-specific and the repository has no existing installer harness, add the smallest practical regression checks only if the project's test conventions can validate the installer text or helper contract without making tests brittle. At minimum, verify by building/running the Windows installer path on Windows that:

- Installing while TideCode is open in the foreground closes TideCode and completes.
- Installing while TideCode is minimized to the tray also closes TideCode and completes.
- Installing while TideCode is not running completes normally.
- A process that cannot be terminated produces a clear failure rather than a partial install.
- The post-update launch still starts the new TideCode version once, without duplicate instances.
- The existing firewall and per-user installation behavior remains unchanged.
- A normal TideCode launch opens in a centered, non-maximized window at the chosen comfortable default size.
- The default window is clamped to smaller work areas and does not exceed the display work area.
- The user can still maximize and resize the window manually.

## Implementation order

1. Refine the NSIS process-termination helper and choose the bounded wait/error behavior.
2. Call it from `customInit` before replacement begins.
3. Preserve and review the existing `${isUpdated}` relaunch block.
4. Change `createApplicationWindow.ts` to calculate centered, clamped default bounds and remove automatic maximizing.
5. Add only targeted test/documentation adjustments supported by the repository's conventions.
6. Run typecheck/unit tests, then build the packaged Windows installer and perform the Windows foreground/tray/update and window-size scenarios.

## Known planned file operations

- Modify `installer/installer.nsh`: add safe TideCode process detection/termination, bounded waiting, failure handling, and installer status messaging.
- Modify `electron/window/createApplicationWindow.ts`: replace full-screen/maximized startup with centered, responsive default bounds.
- Potentially create or modify a focused test under `tests/` only if a stable unit-level seam exists for the window-bounds calculation or installer contract; do not add brittle tests that merely assert formatting.

## Acceptance criteria

- Starting a TideCode installer while TideCode is running no longer fails because TideCode holds files open.
- The installer terminates only the TideCode desktop executable, waits for it to exit, and proceeds automatically.
- If termination fails, the user receives an actionable error and the installer does not continue unsafely.
- Existing fresh-install, reinstall, uninstall, and electron-updater relaunch behavior remains intact.
- A normal launch opens in a centered, comfortable, non-maximized window that fits common laptop and desktop displays.
- The app does not force fullscreen or maximized mode by default, while manual maximize/resize remains available.
