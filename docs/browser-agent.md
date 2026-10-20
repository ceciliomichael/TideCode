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
- `browser.interact`: navigates, clicks coordinates or element references, fills inputs, types, presses keys, and scrolls.
- `browser.terminate`: requests closure of the specified visible tab.
- `browser.devtools`: reads bounded console/network logs and performance metrics; privileged evaluation requires user-enabled Developer Mode.

AI-created tabs use the same responsive, full-panel webview as user-created tabs. Browser tool screenshots are real 1280 x 720 PNGs captured by temporarily overriding Chromium device metrics; tool input uses the same CSS coordinate space. The override may briefly reflow the live page while the AI reads or interacts, but it is cleared afterward so the user's tab fills the available panel again. Structure references expire on navigation or later structure reads. Browser read details are shown literally as text, and screenshot previews are content-sized.

## Security and lifecycle

Only HTTP(S) web pages may be automated. Incognito guests are excluded from enumeration and automation. The agent is scoped to an active project, with tab ownership checked in the desktop. Raw CDP operations and JavaScript evaluation require explicit user-enabled Full Developer Mode for the running app/project. Native DevTools and the AI debugger share an exclusive Chromium debugging connection.

Browser tabs remain alive when the panel is hidden as long as their owning project browser surface remains mounted. Switching projects or destroying the window can close its tabs. If the renderer does not attach an AI tab, the open operation times out and reports the error.

## Verification

Run `npm run typecheck`, focused Code Mode and browser tests, and `npm run build`.

A real native Electron browser integration test exercises the visible webview rather than a duplicate hidden window:

```powershell
$env:TIDECODE_RUN_NATIVE_BROWSER_TESTS='1'
node --import tsx --test tests/components/browser/browserAgentTabs.test.ts
```

The test validates tab registration, one Electron window, live-viewport screenshots without repeated page resize, combined read, semantic click/fill, diagnostics permission checks, and removal of the closed tab.
