# Plan 085: Browser Localhost, Error Visibility, and DevTools

## Status

Implemented.

## Goal

Make TideCode's desktop Browser behave like a normal Chromium browser for local development:

1. bare local development addresses such as `localhost:3000` must load over HTTP by default;
2. failed local navigation must show a useful error instead of an unexplained white screen;
3. the embedded page must expose Chromium DevTools for inspection, console, network, storage, React/Next.js debugging, and element inspection;
4. browser keyboard shortcuts should include a guest-page DevTools shortcut;
5. Next.js's own development indicator/error overlay must remain untouched so it can render naturally inside the page.

## Findings

### 1. TideCode incorrectly upgrades bare localhost URLs to HTTPS

`BrowserPanel.normalizeBrowserInput()` currently treats any host-like input as HTTPS:

```text
localhost:3000 -> https://localhost:3000
```

Local Next.js, Vite, and similar development servers normally listen on plain HTTP unless explicitly configured for TLS. This can make a healthy local app fail to load.

The same problem applies to common loopback forms such as `127.0.0.1:3000` and `[::1]:3000`.

### 2. Webview load failures are effectively invisible

The Electron webview currently listens for:

- `dom-ready`
- `did-start-loading`
- `did-stop-loading`
- navigation events
- title changes

It does not listen for `did-fail-load` or renderer-process failure events.

The browser content area has a white background, so a failed localhost navigation can look like an empty white page with no explanation.

### 3. The desktop browser is real Chromium, but TideCode does not expose its DevTools

Desktop mode renders an Electron `<webview>`, so it is already a real Chromium guest page rather than an iframe or screenshot.

Electron 43 exposes the required webview/WebContents APIs:

- `openDevTools()`
- `closeDevTools()`
- `isDevToolsOpened()`
- `inspectElement()`

TideCode currently exposes none of these in the Browser UI.

### 4. The Next.js development indicator should not be recreated by TideCode

The Next.js development indicator and error overlay are page-owned UI. A correctly loaded Next.js development page inside a Chromium webview should render them itself.

TideCode should therefore fix navigation/render failures and provide DevTools, not inject a fake Next.js indicator.

If the Next.js overlay still does not render after localhost is loading correctly, guest DevTools will make the actual page/runtime error visible instead of hiding it behind a white surface.

## Planned implementation

### 1. Make URL normalization development-host aware

Move browser address normalization into `browserTabUtils.ts` so it is independently testable.

Rules:

- explicit `http://` or `https://` remains unchanged;
- `localhost`, loopback IPv4, `0.0.0.0`, and loopback IPv6 host inputs default to `http://`;
- ordinary hostname/domain inputs continue to default to `https://`;
- text containing spaces continues to use Google search;
- existing default-home behavior remains unchanged.

Examples:

```text
localhost:3000               -> http://localhost:3000
127.0.0.1:5173/app          -> http://127.0.0.1:5173/app
[::1]:3000                  -> http://[::1]:3000
example.com                 -> https://example.com
http://localhost:3000       -> unchanged
```

### 2. Add explicit webview failure state

Extend the Electron webview event handling in `BrowserPanel.tsx`:

- clear the current failure when a main-frame navigation starts successfully;
- capture `did-fail-load` details for the main frame;
- capture guest renderer crashes/termination where supported;
- show an in-browser error surface with the failed URL, Chromium error description/code, and Retry action;
- do not replace the page for subresource failures;
- keep navigation/address/title state intact.

This makes failed localhost, refused connection, TLS, DNS, and crashed-renderer cases visible instead of white.

### 3. Add Browser DevTools controls

Add a compact DevTools button to the Browser toolbar in Electron desktop mode.

Behavior:

- clicking it opens DevTools for the active webview guest, not TideCode's renderer;
- clicking while DevTools is already open focuses/keeps the existing guest DevTools rather than creating duplicate inspectors;
- the user can use the standard Elements picker inside DevTools to inspect the embedded page;
- this gives access to Console, Network, Sources, Application/Storage, performance tooling, and installed page-compatible extensions.

### 4. Add guest-page DevTools keyboard shortcuts

When an Electron webview guest attaches, register guest-only input handling:

- `F12` opens/toggles guest DevTools;
- `Ctrl+Shift+I` / `Cmd+Option+I` opens/toggles guest DevTools;
- normal browser Ctrl+R remains guest-owned when the webview has focus;
- TideCode's main-renderer Ctrl+R protection remains unchanged.

The shortcut handler must attach to guest WebContents only so it does not reopen TideCode's own renderer DevTools.

### 5. Preserve the current Browser architecture

Do not replace the Electron webview with BrowserView/WebContentsView, a custom proxy, or another browser engine in this fix.

The current desktop webview is sufficient once its URL handling, error visibility, and debugging integration are corrected.

The remote/web Browser path remains screenshot/CDP based and is outside the scope of the localhost desktop fix because remote `localhost` refers to the remote host, not the user's Windows machine.

## Planned project structure

```text
tidecode/
├── docs/
│   └── plan/
│       └── plan-085.md                         # create
├── electron/
│   └── window/
│       └── createApplicationWindow.ts          # modify
├── src/
│   └── components/
│       └── browser/
│           ├── BrowserPanel.tsx                # modify
│           └── browserTabUtils.ts              # modify
└── tests/
    └── components/
        └── browser/
            └── browserTabUtils.test.ts         # create
```

## File-by-file changes

### Create

- `docs/plan/plan-085.md`
  - Record findings, implementation boundaries, affected files, and verification.

- `tests/components/browser/browserTabUtils.test.ts`
  - Test explicit schemes, localhost, IPv4 loopback, IPv6 loopback, ordinary domains, searches, and empty input.

### Modify

- `src/components/browser/browserTabUtils.ts`
  - Own the browser input normalization helper.
  - Default local-development hosts to HTTP.
  - Preserve HTTPS defaults for normal web hosts.

- `src/components/browser/BrowserPanel.tsx`
  - Use the shared URL normalizer.
  - Track main-frame webview navigation failures.
  - Render a clear failure/retry UI.
  - Add the active guest DevTools toolbar action.
  - Extend the local webview type with the supported DevTools methods.

- `electron/window/createApplicationWindow.ts`
  - Register guest-webview DevTools keyboard shortcuts when a webview is attached.
  - Scope shortcuts to guest WebContents and preserve the existing main-renderer Ctrl+R protection.

## Verification

### Automated

```powershell
npm test -- tests/components/browser/browserTabUtils.test.ts
npm run typecheck
npm run build
git --no-pager diff --check
```

Completed:

- focused browser URL tests: 5/5 passing;
- `npm run typecheck` passing;
- `npm run build` passing;
- `git --no-pager diff --check` passing.

The manual GUI checks below remain the final runtime verification in the
packaged/running Electron app.

### Manual: localhost

1. Start a local Next.js/Vite server on a normal HTTP port.
2. Enter `localhost:<port>` without a scheme.
3. Confirm TideCode navigates to `http://localhost:<port>`.
4. Confirm the app renders rather than showing a white screen.
5. Repeat with `127.0.0.1:<port>`.
6. Confirm an explicit `https://localhost:<port>` is still respected if deliberately entered.

### Manual: failed navigation

1. Enter an unused local port such as `localhost:65530`.
2. Confirm a readable load error is shown.
3. Start the server.
4. Use Retry.
5. Confirm the page loads normally.

### Manual: Next.js development UI

1. Open a Next.js app in development mode.
2. Confirm Next.js's own development indicator is visible when Next.js provides it.
3. Introduce a development error.
4. Confirm the Next.js overlay/error UI renders inside the webview rather than being replaced by TideCode UI.

### Manual: DevTools

1. Open a page in the TideCode Browser.
2. Click the DevTools toolbar action.
3. Confirm DevTools targets the embedded page.
4. Inspect an element and verify Console/Network activity belongs to that page.
5. Repeat with F12 and Ctrl+Shift+I while the browser guest has focus.

## Acceptance criteria

- Bare localhost and loopback development URLs default to HTTP.
- Normal internet hostnames still default to HTTPS.
- Failed main-frame loads no longer appear as unexplained white pages.
- Guest-page DevTools can be opened from the Browser toolbar.
- Guest-page DevTools can be opened from standard developer shortcuts.
- Next.js development UI is allowed to render natively in the webview.
- Existing browser tabs, navigation, reload, persistence, and inactive-webview behavior remain intact.
- No browser-engine replacement or unrelated Browser redesign is introduced.
- Focused tests, typecheck, build, and diff check pass.

## Follow-up: Chrome-style loading indicator

Implemented after the main browser pass:

- removed the floating top-right loading spinner from the browser content area;
- moved loading feedback to the bottom-left;
- styled it as a compact white Chromium-like status bubble with a small spinner and `Loading...` label;
- navigation and stop/reload behavior remain unchanged.
