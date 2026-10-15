## Active goals
- Fix the TideCode Windows taskbar/notification-area context popup so it dismisses immediately and reliably, including when right-clicking the tray icon while the popup is open.
- Keep the existing custom popup design; change dismissal behavior only.

## User constraints
- Preserve the popup’s custom colors, sizing, layout, and the **Show/Hide Window** and **Quit TideCode** labels. Do not replace it with a native-styled menu.
- A second right-click on the tray icon while the popup is open should close it, not reopen it, and should behave like an outside click.
- Do not claim live Windows timing is verified based only on source-level or mocked tests.

## Decisions
- Investigate and adapt the tray-click ownership and hit-area handling used by TideStudio in `D:\tidestudio\studio\src-tauri\src\tray.rs`. Its inspected approach uses explicit popup visibility to choose close versus open, ignores the tray icon in outside-click/focus-loss handlers, and expands the tray hit area around the actual click position.
- TideCode’s custom popup remains the chosen design; the native-menu proposal was not approved because it changes appearance.

## Important project facts
- This is an Electron desktop application. The custom tray popup is controlled in the Electron main process.
- TideStudio’s tray implementation is in `D:\tidestudio\studio\src-tauri\src\tray.rs`; its renderer markup is in `D:\tidestudio\studio\tray.html`.
- TideStudio’s tray code accounts for Windows tray bounds that may be zero-sized or fail to cover the full clickable target, including the overflow area.

## Current architecture
- `electron/main.ts` creates the tray and `createTrayPopupController`, routes tray `click` to show the application window, and routes `right-click` to the popup controller’s `toggle`.
- `electron/window/trayPopup.ts` creates and manages a custom `BrowserWindow` popup. It uses `uiohook-napi` for global mouse events, popup bounds for outside-click detection, focus-loss and Escape handlers, and custom HTML markup.
- `tests/trayPopup.test.ts` exercises popup behavior through a mocked Electron window and mouse hook.

## Completed milestones
- Added `tests/trayPopup.test.ts` coverage for outside clicks, Escape, menu actions, hook cleanup, tray click toggling, and matching outside-click dismissal effects.
- Added a Windows tray-menu interaction description to `DESIGN.md`.
- Verified `node --import tsx --test tests/trayPopup.test.ts` passes all 8 tests, `npx tsc --noEmit` passes, ESLint passes for `electron/window/trayPopup.ts` and `tests/trayPopup.test.ts`, and `git diff --check` passes.
- Confirmed `uiohook-napi` imports successfully in the development environment. This does not verify that the global hook delivers events correctly in the live Windows application.

## Known failures and workarounds
- The user reports that right-clicking elsewhere does not dismiss the popup immediately; earlier attempts did not resolve the observed behavior.
- Previous tests primarily asserted source structure and mocked event sequences. They do not establish actual Windows tray event ordering, hit-testing, or visual dismissal timing.
- The proposed TideStudio-inspired correction is not yet implemented or validated in TideCode. The possibility that raw tray bounds miss the click and allow the later tray callback to reopen the popup remains suspected, not confirmed.
- The popup’s blur-based dismissal has been associated with a reported brief visual delay or appearing behind another window. Live behavior has not been observed directly.

## Important files and symbols
- `electron/window/trayPopup.ts`: `createTrayPopupController`, `toggle`, `hidePopup`, `startOutsideClickHook`, `activeTrayBounds`, `suppressNextTrayToggle`, `containsPoint`.
- `electron/main.ts`: tray creation and `nextTray.on('right-click', ...)`.
- `tests/trayPopup.test.ts`: mocked popup and tray-dismissal regression tests.
- `DESIGN.md`: Windows tray-menu behavior expectations.
- TideStudio reference: `D:\tidestudio\studio\src-tauri\src\tray.rs`.

## Open work
- Implement the TideStudio-style single-owner tray toggle in TideCode: when explicitly visible, a tray right-click closes and returns; otherwise it opens. Avoid having the outside-click/focus-loss path close the popup and then allowing the same click’s tray callback to reopen it.
- Investigate robust tray hit-area detection using the actual click position, rather than relying only on `Tray.getBounds()`, which may not cover the clicked target.
- Update regression tests for explicit visibility-based toggling and expanded tray hit areas.
- Re-run tests, typecheck, lint, and `git diff --check`; then verify dismissal timing and right-click behavior in the running Windows application.
