Status: implemented

# Plan 024: Continue from the completed provider step

## Goal
Fix the remaining Code Mode stop-after-first-tool regression by basing TideCode continuation on the completed provider step, not the outer stream's terminal finish event.

## Findings
- The newest failing history again contains a completed code_mode call and tool result with no follow-up assistant response.
- Plan 023 requires processRuntimeStream.lastFinishReason === 'tool-calls'. That value comes from the outer full-stream finish event and is not reliable for the Codex custom-tool path.
- onStepEnd already records the authoritative provider step finishReason and responseMessages. A completed step with finishReason 'tool-calls' plus a code_mode tool result is sufficient evidence that TideCode must continue.

## Changes
- Make continuation depend on lastCompletedStep.finishReason === 'tool-calls', a completed code_mode tool result, and a non-aborted stream.
- Stop depending on the outer stream finish reason for this decision.
- Preserve the same cache key, messages, system prompt, tools, reasoning settings, compaction, steering, and history behavior from Plan 023.

## Reliability and cache
- Do not retry the completed tool call. Continue from its recorded assistant/tool response messages.
- A normal completed model step with finishReason 'stop' must not trigger a restart.
- Cache-key derivation and provider cache options remain unchanged.

## Verification
- Add regressions where the outer stream reports null or stop but the completed provider step is tool-calls; both must continue.
- Add a guard proving an outer tool-calls signal cannot force continuation when the completed provider step is stop.
- Run focused continuation/runtime/Code Mode/cache tests, npm run typecheck, and scoped git diff --check.

## Scope boundaries
No changes to Code Mode syntax, provider authentication, apply_patch behavior, cache-key derivation, compaction algorithms, or UI behavior.
