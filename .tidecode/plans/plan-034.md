---
status: draft
---

# Global overlay scrollbar

Goal: Replace TideCode's native global scrollbar rendering with a true custom overlay scrollbar that reserves no layout space and appears only while hovering the scrollable area that owns it.

Findings:
- Native Chromium scrollbars can reserve layout width even when their thumb is transparent.
- The explorer tab list already uses an overlay thumb and is the intended interaction reference.
- TideCode has many overflow-auto/overflow-y-auto regions, so changing each one individually would be repetitive and fragile.

Changes:
- Hide native scrollbars globally with zero-size WebKit scrollbars.
- Add one global React overlay-scrollbar controller that detects the nearest hovered scrollable region independently for vertical and horizontal scrolling.
- Draw fixed overlay thumbs at that region's edge using the existing --color-scrollbar-thumb and --color-scrollbar-thumb-hover variables and the existing 8px global thickness.
- Support dragging the custom thumb while preserving normal wheel, trackpad, keyboard, and programmatic scrolling.
- Exclude the workspace tab strip because it already owns its custom 3px scrollbar.
- Remove stable scrollbar gutters so no scroll area reserves scrollbar space.

Verification:
- Run git diff --check.
- Run TypeScript/build verification and lint.
- Keep changes limited to global scrollbar behavior and its mounting point.
