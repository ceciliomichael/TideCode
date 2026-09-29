# Plan 086: Dockable Browser DevTools

## Status

Implemented.

## Goal

Let TideCode Browser DevTools open as a docked sidebar instead of only as a floating window, while preserving a floating option.

## Behavior

The Browser DevTools control will support:

- **Right sidebar**: dock DevTools to the right side of the browser page.
- **Bottom**: dock DevTools below the browser page.
- **Floating**: open DevTools in a normal undocked window that can still be docked later.

The current detached-only behavior will be removed because Electron's `detach` mode cannot be docked back into the page.

The selected mode will be remembered for the current TideCode session and used by:

- the Browser toolbar DevTools button;
- `F12`;
- `Ctrl+Shift+I`;
- `Cmd+Option+I`.

Default mode: **Right sidebar**.

## Findings

Electron 43 natively supports:

```text
left
right
bottom
undocked
detach
```

For TideCode, the useful modes are `right`, `bottom`, and `undocked`.

The renderer webview API exposes `getWebContentsId()`, but its direct `openDevTools()` method does not accept the dock-mode options we need. The main-process `WebContents.openDevTools({ mode })` does.

Therefore TideCode should use a small typed IPC call from the Browser renderer to the main process, passing:

- the active webview's `webContentsId`;
- the requested dock mode.

The main process must validate that the target is a webview guest belonging to the requesting TideCode window before opening DevTools.

## Planned implementation

### 1. Add typed DevTools dock modes

Add a Browser DevTools mode type:

```ts
type BrowserDevToolsDockMode = 'right' | 'bottom' | 'undocked'
```

Expose a small desktop-only API for opening DevTools for a supplied guest webContents ID.

### 2. Add secure main-process DevTools IPC

Register a `browser:openDevTools` handler that:

1. validates the requested mode;
2. resolves the requested webContents ID;
3. verifies the target is a `webview` guest;
4. verifies that guest belongs to the requesting TideCode renderer;
5. calls `target.openDevTools({ mode, activate: true })`.

Invalid IDs/modes must be ignored/rejected rather than opening arbitrary Electron DevTools targets.

### 3. Add compact mode selection to Browser toolbar

Keep the current code icon.

The DevTools control will become a compact split control:

- clicking the code icon opens DevTools using the currently selected mode;
- a small adjacent chevron opens a TideCode-styled menu;
- menu options:
  - Right sidebar
  - Bottom
  - Floating

The active option gets a checkmark.

The menu should close after a selection, on outside click, or when the Browser tab becomes inactive.

### 4. Make shortcuts use the selected mode

The current main-process guest shortcut handler always opens `detach`.

Change it so the Browser renderer owns the selected dock mode and communicates it to the guest/main-process path.

The simplest implementation is:

- renderer persists the current mode in module/session state;
- toolbar opens through the typed Browser DevTools IPC;
- main-process guest keyboard shortcuts use **right sidebar** as their default native mode unless a selected mode has been communicated for that guest.

When a mode is selected, TideCode stores it for that guest/session so F12 and Ctrl+Shift+I use the same mode.

### 5. Do not build a fake DevTools sidebar

Do not render Chromium DevTools as a TideCode React panel.

Use Electron's native docking support so Elements, Console, Network, Sources, Application, React/Next.js tooling, element picker, resizing, and DevTools focus behavior all remain Chromium-native.

## Planned affected file tree

```text
tidecode/
├── docs/
│   └── plan/
│       └── plan-086.md
├── electron/
│   ├── ipc/
│   │   └── registerCoreIpcHandlers.ts
│   ├── preload.ts
│   └── window/
│       └── createApplicationWindow.ts
├── src/
│   ├── components/
│   │   └── browser/
│   │       └── BrowserPanel.tsx
│   └── types/
│       └── browser.ts
└── tests/
    └── components/
        └── browser/
            └── browserDevTools.test.ts
```

## File-by-file changes

### Modify

- `src/types/browser.ts`
  - Add Browser DevTools mode/input/API types.

- `electron/preload.ts`
  - Expose the typed Browser DevTools IPC method.

- `electron/ipc/registerCoreIpcHandlers.ts`
  - Validate webview ownership and requested mode.
  - Open native Chromium DevTools in the requested dock state.

- `electron/window/createApplicationWindow.ts`
  - Stop forcing `detach` for guest keyboard shortcuts.
  - Use the selected/default dock mode.

- `src/components/browser/BrowserPanel.tsx`
  - Add `getWebContentsId()` to the local webview type.
  - Replace direct `webview.openDevTools()` with the typed dock-mode API.
  - Add the small mode dropdown beside the code icon.
  - Default to Right sidebar.
  - Keep Bottom and Floating available.

### Create

- `tests/components/browser/browserDevTools.test.ts`
  - Cover valid dock modes and rejection of invalid mode values through extracted validation helpers where practical.

## Verification

```powershell
npm test -- tests/components/browser/browserDevTools.test.ts tests/components/browser/browserTabUtils.test.ts
npm run typecheck
npm run build
git --no-pager diff --check
```

## Manual verification

1. Open a webpage in TideCode Browser.
2. Click the code icon.
3. Confirm DevTools opens docked on the right by default.
4. Switch to Bottom and confirm DevTools docks underneath.
5. Switch to Floating and confirm it opens undocked.
6. Return to Right sidebar and confirm the mode is reused.
7. Press F12 and Ctrl+Shift+I while the browser guest is focused and confirm the expected dock mode is used.
8. Confirm DevTools still targets the embedded webpage, not TideCode's own renderer.
9. Confirm closing DevTools returns the browser page to full size.

## Acceptance criteria

- DevTools can be docked to the right.
- DevTools can be docked to the bottom.
- DevTools can still be opened floating.
- Right sidebar is the default.
- The toolbar clearly exposes the mode choice without adding a large new toolbar section.
- Standard DevTools shortcuts still work.
- DevTools always targets the active Browser webview.
- The renderer cannot use the IPC to open DevTools for unrelated WebContents.
- Existing Browser navigation, tabs, localhost handling, loading indicator, and error UI are unchanged.

## Windows correction discovered during implementation

The first implementation attempted to rely directly on
`WebContents.openDevTools({ mode: 'right' })`.

Electron documents that on Windows, when Window Control Overlay is enabled,
DevTools is forced into detached mode. TideCode uses Window Control Overlay for
its custom title bar, so Electron ignored the requested right/bottom dock mode
and still opened a floating DevTools window.

The corrected implementation keeps TideCode's custom title bar and uses
`setDevToolsWebContents()` with a TideCode-owned `WebContentsView`. The React
Browser layout reserves a real right/bottom panel and synchronizes its bounds to
the native DevTools view. Floating mode continues to use Chromium's undocked
window.

## Verification result

- Browser DevTools + browser URL focused tests: 7/7 passing.
- `npm run typecheck`: passing.
- `npm run build`: passing.
- Existing Vite bundle-size/static-dynamic import warnings remain unchanged and
  are unrelated to this browser change.
