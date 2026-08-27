# Plan 028 - Preserve Codex custom tool call shape

Status: implemented

## Goal
Fix Codex continuation requests that fail after a freeform Code Mode tool call with `Unknown parameter: 'input[2].arguments'.`

## Findings
- The OpenAI Responses adapter correctly emits Code Mode replay items as `custom_tool_call` with an `input` field.
- TideCode's Codex request normalizer currently treats any item with `call_id` or `name` as a legacy function call, so it injects an `arguments` property into `custom_tool_call` items.
- The Codex backend rejects `arguments` on `custom_tool_call`; these items must retain their native `input` field instead.

## Implementation
- Update Codex request normalization so `custom_tool_call` and `custom_tool_call_output` are never classified as legacy function calls.
- Keep existing Responses `function_call.arguments` serialization and true legacy `tool_call` / `function` compatibility unchanged.
- Add an exact regression with a `custom_tool_call` at input index 2 and assert that normalization preserves `input` and omits `arguments`.

## Reliability and Compatibility
- No provider prompt, cache key, Code Mode runtime, or tool API changes.
- Preserve old history/function-call compatibility.
- Keep the fix scoped to Codex request-body normalization.

## Verification
- Run `tests/codex/codexRequestNormalization.test.ts`.
- Run focused Codex continuation/client regressions.
- Run `npm run typecheck`.
- Run scoped `git diff --check`.

## Scope
Only the Codex request-normalization bug and its regression coverage.
