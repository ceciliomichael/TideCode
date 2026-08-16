# TideCode CLI Terminal Rendering and Resize Ownership

## Resize ownership

`TerminalScreen` is the single terminal-size coordinator. It observes both `process.stdout` resize events and terminal-size polling. Normal compose, history, and active-turn state redraw through `TerminalScreen.redrawAfterResize()`.

Standalone interactive overlays—`interactiveSelect`, `interactiveResumeSelect`, `interactiveChecklist`, and `interactiveTextInput`—temporarily own the foreground terminal rows. While one is active, `TerminalScreen` must delegate resize redraw to that overlay instead of repainting underneath it. The shared contract is `electron/cli/interactiveResize.ts`: an overlay registers a resize handler, asks the host to redraw the background from current screen state, discards its cached row/cursor frame, and renders itself fresh at the new dimensions. Cleanup unregisters the handler.

The resume selector also recomputes its default page size from the current `process.stdout.rows` on each render so terminal-height changes immediately affect the list viewport.

## Why fresh redraw is required

Terminal hosts reflow existing rows when width changes, so cursor positions and rendered-row counts captured before the resize are no longer trustworthy. Diffing an overlay against those reflowed rows, or allowing both the background screen and overlay to redraw independently, can duplicate the TideCode session panel and make the active selector disappear. Resize handling must therefore rebuild the background and then paint the overlay as a fresh frame.

## Verification

Regression coverage lives in `tests/cli/terminalScreen.test.ts`, with resume/view behavior covered by `tests/cli/terminalResumeView.test.ts` and `tests/cli/terminalHarness.test.ts`. Verify CLI rendering changes with targeted tests, `npm run typecheck`, changed-file ESLint, and the full test suite.

Verified against the CLI resize and interactive overlay implementations on August 16, 2026.
