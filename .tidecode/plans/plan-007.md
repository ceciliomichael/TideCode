---
status: draft
---

# Preserve underscores in terminal inline code

## Context
The terminal screenshot shows inline-code tool names such as `plan_create` and `plan_update` rendered without their underscores, while the desktop Markdown renderer preserves them.

Inspection found the terminal formatter in `electron/cli/terminalMarkdown.ts`. Its `formatInlineMarkdown` function performed chained regex replacements in this order: bold, inline code, italic, links. Inline-code backticks were removed and ANSI color codes were inserted before the underscore-italic regex ran. As a result, the italic regex could treat underscores inside already-formatted code spans as Markdown emphasis delimiters. With two inline-code identifiers such as `plan_create` and `plan_update` in the same string, it could match from an underscore in one identifier to an underscore in the other, removing those visible underscores.

## Goal
Preserve literal characters inside terminal inline-code spans, including underscores, while retaining existing terminal Markdown styling for bold, italic, links, and inline code.

## Non-goals
- Do not change the desktop React Markdown renderer.
- Do not redesign fenced-code rendering.
- Do not alter unrelated CLI output or tool naming.
- Do not add dependencies.

## Affected files
- `electron/cli/terminalMarkdown.ts`: isolate inline-code spans from subsequent emphasis parsing.
- `tests/cli/terminalMarkdown.test.ts`: focused regression coverage for inline code containing underscores and surrounding emphasis.

## Implemented solution
1. Added `formatNonCodeMarkdown` for the existing bold, italic, and link transformations.
2. Updated `formatInlineMarkdown` to split out backtick-delimited inline-code spans before applying non-code Markdown parsing.
3. Inline-code spans are rendered directly with the existing `colors.info` styling, preserving their exact inner text.
4. Added regression tests for `plan_create`, `plan_update`, `a_b_c`, and underscore italics outside inline code.

## Verification
- `node --import tsx --test tests/cli/terminalMarkdown.test.ts`: passed, 3 tests.
- `npm run typecheck`: passed.
- `git diff --check -- electron/cli/terminalMarkdown.ts tests/cli/terminalMarkdown.test.ts`: passed.

## Risks and edge cases
- Inline Markdown parsing remains intentionally lightweight and regex-based.
- Backtick escaping and nested Markdown remain outside the current formatter capabilities and were not broadened by this fix.

## Acceptance criteria
- [x] Terminal output displays `plan_create` and `plan_update` with underscores intact.
- [x] Inline-code content is not interpreted as italic or bold Markdown.
- [x] Existing underscore emphasis outside inline code remains functional.
- [x] Targeted regression tests and TypeScript type checking pass.
