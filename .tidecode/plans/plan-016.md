---
status: implementation_started
---

# Defer Implement Plan while AI is streaming

## Goal
Allow the Plan tab’s “Implement plan” button to be clicked while an AI turn is streaming, defer the implementation request until that turn finishes, and preserve the existing immediate-send behavior when idle.

## Findings
- src/pages/chatInterface/useChatMessageActions.ts currently defines isAiBusy, hides the button whenever it is true, and returns immediately from handleImplementPlan while busy.
- The existing follow-up queue in src/pages/chatInterface/useChatMessageQueue.ts already stores messages during an active turn and auto-processes them when the turn ends.
- src/pages/chatInterface/ChatInterfaceContent.tsx sends queued messages through the normal sendNewMessages path using the current runtime selection.
- The implementation flow must also persist the plan handoff, switch from plan mode to agent mode, and send the generated implementation prompt; these side effects need to occur at the correct time for a deferred request.
- Existing queue auto-send tests are in tests/chatQueueAutoSend.test.ts; no dedicated implementation-button tests were found.

## Implementation
1. Update the plan action flow in useChatMessageActions.ts so a valid implementation request clicked during streaming is represented as a queued follow-up rather than discarded. Keep plan-path validation and handoff persistence guarantees, avoid duplicate enqueue/send behavior, and ensure the deferred request uses agent mode/runtime when it is released.
2. Update button visibility/click wiring in ChatConversationSurface.tsx (and parent props only if required) so the button remains available when a completed plan exists even while AI is busy, with clear state/label behavior indicating it is waiting rather than silently doing nothing.
3. Reuse the existing queue lifecycle rather than adding a second timer or stream listener: the queued implementation request should be released once, only after the active turn is no longer sending, and should retain existing queue failure/requeue behavior.
4. Add focused unit tests for the action/queue contract (click-during-streaming, release-after-stream, idle immediate send, invalid/missing plan path, and no duplicate submission). Extend existing queue tests or add the smallest testable helper module if the hook is not directly testable.
5. Run focused tests, then the full test suite and npm run typecheck. If UI behavior is difficult to cover with unit tests, manually verify: active stream → click button → pending queue state → stream completes → one agent implementation request is sent.

## Acceptance
- Clicking “Implement plan” during an active AI stream never loses the request.
- Exactly one implementation request is sent after streaming completes.
- The request is sent in agent mode and the plan handoff is persisted as before.
- Clicking while idle still sends immediately.
- Invalid or unavailable plan paths remain no-ops.
- Existing composer follow-up queue behavior and tests remain green.
