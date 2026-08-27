Status: implemented

# Plan 023: Continue after completed Code Mode tool calls

## Goal
Ensure a TideCode agent turn always returns to the model after a successful local Code Mode tool call. A provider stream must not be allowed to end the whole run at step 0 when that step finished with `tool-calls` and produced a completed `code_mode` result.

## Findings
- The failing Codex history recorded step 0 as `finishReason: tool-calls`, containing both the Code Mode call and its successful result, then immediately recorded `run_completed` with no step 1.
- The same freeform Code Mode tool continues correctly in an isolated AI SDK stream, so the defect is specific to the real provider stream path rather than CodeModeExecutor.
- Prompt caching is keyed before streaming and passed through `ProviderStreamFactoryInput.cacheKey`; provider cache options are derived from that unchanged key.

## Changes
- Add a narrow shared-runtime continuation fallback for the abnormal case where a stream ends immediately after a completed local Code Mode tool boundary.
- Reuse the same provider stream factory, system prompt, tool set, cache key, reasoning settings, repair logic, prepareStep behavior, and canonical response messages for the continuation request.
- Do not retry Code Mode execution. The continuation request starts from the already completed assistant tool-call plus tool-result messages and asks the model for the next step.
- Keep normal multi-step provider behavior unchanged. If the first stream already reaches a model stop/final response, no fallback runs.
- Bound the fallback with the existing step/abort semantics so it cannot create an unbounded retry loop.

## Cache and reliability
- Preserve the exact existing prompt cache key across the continuation. Do not derive a new key or alter provider cache policy.
- Preserve canonical replay/history ordering so the forced continuation is recorded as the next step, not a separate user turn.
- Respect aborts and existing automatic compaction/steering preparation before each continuation step.
- No new dependencies.

## Verification
- Add a regression that reproduces: step 0 finishes with `tool-calls`, Code Mode result is completed, provider stream closes, TideCode explicitly starts the continuation and receives a final model response.
- Verify providers that already continue normally do not get a duplicate extra continuation.
- Assert the continuation receives the same `cacheKey` as the original stream and includes the completed tool-call/result context.
- Run focused runtime/Code Mode/cache tests, `npm run typecheck`, and scoped `git diff --check`.

## Scope boundaries
No changes to Code Mode source/freeform syntax, apply_patch behavior, provider authentication, cache-key derivation, compaction algorithms, UI rendering, or unrelated runtime behavior.
