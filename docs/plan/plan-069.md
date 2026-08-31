# Plan 069: JSX-safe Code Mode mutations

## Goal
Make TideCode's built-in Code Mode resilient to model-generated redundant quote escaping in JSX/TSX while preserving the existing conservative patch semantics.

## Changes
- Port the conservative triple-quote delimiter normalization used by the filesystem MCP into TideCode's Code Mode repair path, so systematic redundant JSX quote escapes are removed without changing legitimate backslashes, regexes, paths, or template syntax.
- Extend `apply_patch` recovery to recognize one redundant quote-escaping layer only when the resulting source anchor has exactly one non-overlapping match.
- Decode replacement lines only when that quote-escape recovery was actually used.
- Add React/TSX regressions for both whole-file write repair and `apply_patch`, including ambiguity rejection.

## Verification
- Run focused Code Mode and apply_patch tests.
- Run TypeScript typecheck and targeted lint for changed files.
- Run `git diff --check`.

## Scope
Only Code Mode source repair, apply_patch matching/recovery, their tests, and this plan are in scope. Existing unrelated MCP/UI working-tree changes are left untouched.
