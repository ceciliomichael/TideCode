Status: implemented

# Plan 015: Hide edit from Code Mode

## Goal
Make apply_patch the only targeted source-editing API visible and callable in production Code Mode while retaining the native edit tool for internal and legacy compatibility.

## Changes
- Exclude edit from the Code Mode registry using the existing exclusion mechanism.
- Remove the explicit tools.edit guidance from the Code Mode description.
- Keep nativeTools.edit and the edit implementation unchanged.
- Keep tool_search MCP-only so edit cannot be rediscovered.
- Update Code Mode tests to assert edit is absent/unavailable while native edit still exists.
- Move compatibility assertions that still matter to the native edit surface or apply_patch path.

## Reliability and scope
No patch parser, matcher, mutation semantics, or native edit behavior changes. No new dependencies.

## Verification
- Run focused agent tool, Code Mode, apply_patch, tool-call repair, and mutation reliability tests.
- Run npm run typecheck.
- Run scoped git diff --check for files changed by this plan.
