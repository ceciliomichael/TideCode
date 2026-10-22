# TideCode Browser Agent

TideCode's desktop Electron browser supplies its own Chromium engine. No external Chrome, WebDriver, or Playwright installation is required.

AI tools execute in a separate Node run service. The service forwards browser requests over the authenticated desktop connection. The Electron main process routes the request to the actual browser tab owned by TideCode's renderer. The run service never creates browser windows itself.

## Visible AI tabs

`tools.browser.open({ url })` instructs the desktop to open and select a real browser tab within the existing TideCode browser panel. The desktop waits for the renderer's normal Electron `<webview>` to register with the agent tab registry. There is no separate AI-created hidden browser window or duplicate page. The browser toolbar, tab strip, navigation, annotations and DevTools use the same live `webContents` as AI screenshots, DOM inspection, and interactions.

The new tab displays a small AI icon. Users can switch between tabs, observe changes, interact manually, or hide the panel while the tab remains mounted. A closed webview is removed from the registry, and stale tab references fail. AI-requested termination closes that visible tab through the renderer.

## Tool discovery

Use `tools.available.list({ namespace: "native_browser" })` to discover the six browser tools, then retrieve an exact contract via `tools.available.get({ name: "tools.browser.open" })`. The discovery namespace does not change the callable API path.

- `browser.open`: opens a visible project browser tab and waits for attachment.
- `browser.read`: reads screenshot, DOM/accessibility references, annotations or a combined view.
- `browser.tabs`: lists project tabs, ten per page, including normal visible webviews.
- `browser.interact`: navigates, clicks element references, fills inputs, types, presses keys, and scrolls.
- `browser.terminate`: requests closure of the specified visible tab.
- `browser.devtools`: reads bounded console/network logs and performance metrics, and supports JavaScript evaluation and raw CDP commands by default.

AI-created tabs use the same responsive, full-panel webview as user-created tabs. Browser reads accept optional integer `width` and `height` from 1 to 4096 CSS pixels, defaulting independently to 1280 and 720 on each read. Screenshots are real PNGs at the requested size, with responsive layout and media queries evaluated at that size. Each tab remembers its last successful read dimensions for subsequent input, including reference clicks and fills; interaction requires no resolution arguments. The override may briefly reflow the live page while the AI reads or interacts, but it is cleared afterward so the user's tab fills the available panel again. Structure references expire on navigation or later structure reads. Browser read details are shown literally as text, and screenshot previews are content-sized.

Open a page once, or find an existing tab through `browser.tabs`, then retain its `tab_id` across reads, interactions and navigation. Reads accept no URL. The URL shown in results describes the existing tab; it is not an instruction to reload. Reads and non-navigation input preserve the live document, form values and JavaScript state. A click may still navigate if that is the page's own behavior.

Combined reads use one viewport scope for capture and structure extraction. The embedded surface temporarily scales to fit its existing panel so Chromium paints the full requested viewport, including sizes larger than the desktop. This host transform does not scale the screenshot or change guest CSS coordinates. Embedded styles, background throttling and Chromium metrics are restored after each operation. No fixed paint sleep or full-resource-load wait is required; pending images may appear incomplete. DOM positions account for document scrolling and display scaling. Reference clicks and fills scroll immediately, measure and dispatch input before restoring the viewport, retaining hidden/disabled/obscured checks. Invalid fill requests do not click the target.

## Security and lifecycle

Only HTTP(S) web pages may be automated. Incognito guests are excluded from enumeration and automation. The agent is scoped to an active project, with tab ownership checked in the desktop. Raw CDP operations and JavaScript evaluation are always enabled for normal browser sessions. Native DevTools and the AI debugger share an exclusive Chromium debugging connection.

Browser tabs remain alive when the panel is hidden as long as their owning project browser surface remains mounted. Switching projects or destroying the window can close its tabs. If the renderer does not attach an AI tab, the open operation times out and reports the error.

Protocol operations share a 20-second budget, with individual commands limited to six seconds. Timeout errors name the blocked command/stage and elapsed time. A protocol timeout detaches the debugger, rejects further commands from that expired operation and allows a fresh session for cleanup and later requests. Surface and metrics cleanup each have a separate two-second budget. Waiting for an earlier operation on the same tab is limited to ten seconds. Input actions are never automatically replayed. The broker's 45-second deadline remains an outer transport guard; its error identifies the request and does not claim that the desktop disconnected.

## Verification

Run `npm run typecheck`, focused Code Mode and browser tests, and `npm run build`.

A real native Electron browser integration test exercises the visible webview rather than a duplicate hidden window:

```powershell
$env:TIDECODE_RUN_NATIVE_BROWSER_TESTS='1'
node --import tsx --test tests/components/browser/browserAgentTabs.test.ts
```

The test validates tab registration, one Electron window, first combined reads while a resource is pending and the embedded panel is transparent, default, 390x844, 1920x1080 and 4096x4096 full-viewport screenshot pixels, media queries, reference input at the remembered viewport, invalid dimensions, off-screen clicks/fills with smooth scrolling, scaled/scrolled coordinates, invalid-input guards, state retention without reload, stalled-command recovery, diagnostics and tab closure. Set `TIDECODE_BROWSER_REPRO_FILE` to a local HTML file to additionally serve and exercise the plant-shop reproduction from the reported failure. The reproduction leaves the source file unchanged.
