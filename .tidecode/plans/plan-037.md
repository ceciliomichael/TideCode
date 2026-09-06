---
status: draft
---

# Unify Monaco overlay scrollbars

Goal: Make every TideCode Monaco editor use the same global overlay scrollbar behavior as the rest of the app.

Changes:
- Extend the global overlay scrollbar controller with a registered custom scroll-target adapter backed by Monaco editor scroll APIs.
- Register the main workspace editor, embedded Monaco code blocks, and both sides of diff editors.
- Hide Monaco built-in vertical and horizontal scrollbar UI and set its scrollbar sizes to zero so no space is reserved.
- Preserve wheel, keyboard, search, programmatic scrolling, drag behavior, existing 8px TideCode thumb styling, hover behavior, and default mouse cursor.
- Keep the explorer tab scrollbar independent.

Verification:
- git diff --check.
- TypeScript typecheck.
- Targeted ESLint on touched TypeScript files.
- Renderer build.
