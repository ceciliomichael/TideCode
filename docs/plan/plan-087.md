# Plan 087: Smooth Browser DevTools Sidebar and Overlay Fixes

## Status

Implemented.

## Goal

Polish the docked Browser DevTools experience so it feels integrated with TideCode:

1. remove the visible white/blank flash while docked DevTools initializes;
2. prevent the DevTools position dropdown from appearing underneath the native DevTools view;
3. make the TideCode-owned DevTools sidebar frame visually match the application;
4. preserve native Chromium DevTools functionality and avoid unsupported CSS injection into DevTools itself.

## Findings

### 1. The current opening sequence exposes the native initialization

Current flow:

1. React sets `devToolsOpen=true`;
2. the Browser layout immediately reserves ~42% of the page for the DevTools host;
3. the renderer sends `browser:openDevTools`;
4. the main process creates a `WebContentsView`;
5. Chromium initializes the DevTools frontend;
6. the native view becomes visible.

That means the user can briefly see the empty host/native surface while Chromium is still starting, which appears as a flash.

### 2. React z-index cannot beat WebContentsView

`WebContentsView` is a native child view composed above the renderer surface.

Therefore increasing the dropdown's React/Tailwind `z-index` will not solve the issue if the menu overlaps the DevTools view rectangle.

The fix must prevent the dropdown from geometrically overlapping the native DevTools view.

### 3. TideCode can style the frame, not Chromium DevTools internals

TideCode controls:

- the reserved sidebar/bottom host;
- divider;
- background shown while DevTools initializes;
- loading/transition UI;
- surrounding Browser toolbar/menu.

TideCode does **not** safely control the internal CSS of Chromium DevTools.

Injecting CSS into the DevTools frontend would depend on undocumented Chromium internals and could break on Electron upgrades.

The internal DevTools surface should therefore remain Chromium-native. TideCode can blend the surrounding frame and use Chromium's normal light/dark appearance.

## Planned implementation

### 1. Add an explicit DevTools ready lifecycle

Extend the Browser DevTools bridge with a `devToolsReady` event.

For docked DevTools:

1. create/attach the DevTools `WebContentsView` hidden;
2. initialize Chromium DevTools into that view;
3. wait for the DevTools frontend to be ready;
4. notify the Browser renderer;
5. only then reveal the native view.

The React host remains visible during initialization using TideCode's normal surface color instead of exposing a white native flash.

If the view is already initialized and only being reopened/reshown, reuse it so subsequent opens are effectively immediate.

### 2. Animate only the TideCode layout

Add a short width/height transition to the reserved DevTools host:

- Right sidebar: animate width from 0 to the configured width.
- Bottom: animate height from 0 to the configured height.
- Closing: reverse the same transition.

The native DevTools view follows the host bounds through the existing `ResizeObserver`.

Do not attempt opacity animation on `WebContentsView`; it is a native view and does not participate in normal React/CSS compositing.

### 3. Keep a TideCode-colored loading surface until native DevTools is ready

While the docked DevTools view is preparing:

- host background uses TideCode `bg-background` / normal panel surface;
- optional small centered `Opening DevTools...` status using existing muted typography;
- no white flash;
- once ready, reveal the native view over that reserved area.

This placeholder must disappear immediately once the native view is visible.

### 4. Fix the DevTools mode dropdown without relying on z-index

For a right-docked DevTools view:

- open the dropdown toward the **left/browser side** of the toolbar control;
- keep its full rectangle outside the native right-sidebar bounds.

For bottom/floating/closed modes:

- use the normal compact placement as long as it cannot overlap a native view.

Do not hide/show the native DevTools view merely to display the dropdown because that would reintroduce flashing.

### 5. Blend the TideCode-owned frame with the application

Style the dock host around Chromium DevTools using TideCode tokens:

- `bg-background`;
- `border-border`;
- consistent toolbar/dropdown typography;
- no gradient;
- no extra edge shadow;
- compact divider matching the rest of TideCode.

The native Chromium DevTools interior remains untouched.

### 6. Preserve current behavior

Do not change:

- Browser navigation;
- localhost handling;
- loading bubble;
- Browser error UI;
- tab behavior;
- DevTools target ownership checks;
- Floating DevTools mode;
- F12 / Ctrl+Shift+I routing.

## Planned affected files

```text
tidecode/
├── docs/
│   └── plan/
│       └── plan-087.md
├── electron/
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
  - Add ready-event typing for Browser DevTools.

- `electron/preload.ts`
  - Expose the DevTools ready event to the renderer.

- `electron/window/createApplicationWindow.ts`
  - Create docked DevTools hidden.
  - Detect DevTools frontend readiness.
  - Reveal only after initialization is complete.
  - Reuse the initialized native view where safe.

- `src/components/browser/BrowserPanel.tsx`
  - Track `opening / ready / closed` DevTools state.
  - Add short right/bottom host size transitions.
  - Render TideCode-colored initialization surface.
  - Reposition the mode dropdown away from the right native view.
  - Keep the existing code icon and compact menu.

- `tests/components/browser/browserDevTools.test.ts`
  - Extend focused Browser DevTools tests for any extracted ready/layout helpers.

## Verification

```powershell
npm test -- tests/components/browser/browserDevTools.test.ts tests/components/browser/browserTabUtils.test.ts
npm run typecheck
npm run build
git --no-pager diff --check
```

## Manual verification

1. Open Browser DevTools in Right sidebar mode.
2. Confirm the Browser layout expands smoothly instead of flashing white.
3. Close and reopen it; confirm repeat opens are faster/smoother.
4. Open the DevTools position dropdown while the right sidebar is visible.
5. Confirm the dropdown remains fully visible and never sits underneath DevTools.
6. Switch Right -> Bottom -> Right and confirm the host transition remains stable.
7. Confirm the host/divider/background visually match TideCode.
8. Confirm the actual DevTools tabs, Console, Network, Elements, and inspector remain native and functional.
9. Confirm Floating mode remains unchanged.

## Acceptance criteria

- No exposed white/blank flash while docked DevTools initializes.
- Right/bottom opening and closing visually transition rather than abruptly resizing.
- DevTools mode dropdown is never covered by the native DevTools view.
- TideCode-owned DevTools frame uses TideCode design tokens.
- Chromium DevTools internals are not patched or CSS-injected.
- Existing Browser and DevTools functionality remains intact.
