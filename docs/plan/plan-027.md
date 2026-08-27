Status: implemented

# Plan 027: Guarantee the post-tool provider request

## Goal
Fix Luna/Codex stopping after the first Code Mode tool call by making the continuation decision use the completed step from the exact provider stream that just ended, and verify that TideCode actually invokes the provider stream factory a second time.

## Findings
- The latest failing Luna/Codex run `647b8fc3-9b04-49d4-a1ad-58a8d3ee767e` records step 0 with `finishReason: tool-calls` and a completed `code_mode` result, then immediately records `run_completed` with no step 1.
- Running the current continuation predicate against that exact persisted step returns `true`, so the semantic condition is correct.
- The current runtime stores the last completed provider step in mutable outer state and asks the continuation helper for it after the stream finishes. The helper tests only that isolated state model, not the real runtime stream/request wiring.
- Codex's backend has an additional same-turn transport contract: the first response returns `x-codex-turn-state`, and every continuation request in that turn must replay that exact header. TideCode's Codex fetch currently drops it. The reference Codex client stores the first value and reuses it unchanged for retries and continuation requests, then resets it for the next turn.
- The runtime stream processor also currently ignores generic provider `error` stream parts, which can turn a failed continuation request into a false `run_completed`.
- Codex account rotation currently runs inside every HTTP fetch. A continuation can therefore switch accounts mid-turn if usage changes between requests. The selected account must be pinned for the client turn, while OAuth refresh may still update that same account's token.

## Changes
- Capture the last completed provider step locally for each provider stream by wrapping that stream's `onStepEnd` callback.
- Return that exact step together with the processed stream result and make the continuation loop decide from the returned result, not a separate mutable getter.
- Preserve the existing global step recording, replay message accumulation, logical step numbering, steering, compaction, cache key, tools, system prompt, and provider options.
- Add a runtime/request regression proving a completed Code Mode boundary causes a second provider stream creation with the same cache key and with the completed assistant tool-call and tool-result messages included.
- Make the Codex client capture the first `x-codex-turn-state` response header for a client turn and replay it unchanged on every later Codex request from that same client; a new Codex client starts with no turn state.
- Resolve/rotate the Codex account once per client turn, pin that account for all continuation requests, and only refresh OAuth credentials for that pinned account afterward.
- Treat provider stream `error` parts as runtime failures instead of silently completing the run.

## Reliability and cache
- Never re-execute the completed tool. The second provider request receives the already completed tool exchange as context.
- Do not continue after abort or a normal model stop.
- Keep the same prompt cache key and provider cache options across the continuation.
- Keep Codex turn state and the selected account in memory only for the lifetime of one `createCodexClient()` instance. Do not persist turn state or switch accounts inside an active turn.

## Verification
- Run the continuation and runtime stream regressions, including an assertion that the provider stream factory is called twice.
- Add a Codex transport regression proving request 1 has no turn-state header, request 2 replays the first response token, and later response changes cannot replace it.
- Add a runtime stream regression proving a provider `error` part cannot end as successful completion.
- Run existing Code Mode, history/replay, cache, and steering regressions.
- Run `npm run typecheck` and scoped `git diff --check`.

## Scope boundaries
No Code Mode syntax, prompt, tool registry, provider authentication, cache-key derivation, compaction algorithm, or UI changes.
