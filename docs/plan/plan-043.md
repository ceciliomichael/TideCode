# Fix Code Mode invalid regex preflight

## Goal
Allow Code Mode to recover from the common model-generated regex literal that over-escapes a parenthesis and currently fails JavaScript syntax validation before any tool can run.

## Changes
- Reproduce the failing regex form handled by Code Mode validation.
- Add a narrow syntax repair for malformed regex literals caused by doubled backslashes before regex grouping punctuation.
- Add a regression test covering the reported `Text\\(` style search pattern.
- Do not weaken blocked-runtime screening or change tool behavior.

## Verification
- Run the targeted Code Mode test file.
- Run TypeScript type checking if the targeted test passes.

## Scope
Only Code Mode syntax recovery and its regression coverage are in scope.
