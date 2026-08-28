# Plan 034: Persisted Hidden User Context and Append-Only Mode Transitions

## Goal
Persist model-only user context with the originating user message so later provider requests replay the exact same historical prefix. Represent Agent, Plan, and execution-mode changes as hidden transition markers that are sent only when the persisted state actually changes.

## Required behavior
- User-facing message content remains unchanged and hidden context is never rendered in the chat UI.
- Persist the exact hidden context text with each user message instead of regenerating historical injections later.
- Agent and Plan are explicit chat-mode states. A mode marker remains active until a later chat-mode marker supersedes it.
- The first sent turn establishes the current chat mode. Later turns in the same persisted mode add no duplicate marker.
- UI-only mode toggles do not modify history. A new marker is written only on the first user turn sent after a real persisted mode transition.
- Agent activation supersedes Plan. Plan activation supersedes Agent. No separate disable marker is used.
- Terminal execution mode uses the same transition-only persisted hidden-context mechanism.
- Historical hidden context is immutable during replay so provider requests remain append-only whenever model/provider/system/tool identity is otherwise unchanged.
- Plan runtime enforcement remains hard runtime policy, including restricted Code Mode capabilities and active-plan rules.
- Plan Mode keeps both plan_create and apply_patch in its stable tool surface. Before a plan exists, apply_patch rejects because there is no active plan; after a plan exists, plan_create rejects a duplicate and apply_patch may update only that exact active plan. Source-file mutation remains unavailable throughout Plan Mode.
- The persisted Plan marker explicitly documents the hidden plan_create contract, states that its omission from permanent Code Mode documentation is intentional, forbids using tool_search to discover it, and makes runtime policy authoritative over the stable Code Mode capability catalog.
- Compaction treats hidden runtime context as control state, not conversation evidence: strip it from the transcript and prior handoff data shown to the compaction model, then carry only the latest active state into the post-compaction provider replay.

## Implementation
1. Add a typed hidden user-context field to persisted user messages with a small generic context record containing kind and exact content.
2. Add shared helpers to inspect the last persisted state marker and attach a new marker to a user message only when the sent state differs.
3. Generate Agent and Plan chat-mode transition contracts. Plan keeps active-plan state and planning constraints. Agent clearly restores implementation behavior and supersedes prior Plan state.
4. Move chat-mode identity out of transient prompt reconstruction. Build model user messages by appending persisted hidden context to visible content.
5. Persist mode and execution-mode markers when creating or editing the user turn, before the conversation is saved and streamed.
6. Remove transient execution-mode and Plan-mode reconstruction from prompt build/runtime replay paths.
7. Keep the permanent system prompt mode-neutral and retain only stable core, workspace, Code Mode, and shared authority rules there.
8. Preserve hidden context through history replacement, canonical synchronization, replay, compaction suffix construction, and existing message persistence flows.
9. Ensure UI rendering, titles, previews, edit composer content, and user-visible history continue to use only Message.content.

## Verification
- Tests prove hidden context is persisted in history but excluded from visible user rendering data.
- Tests prove the first Agent or Plan turn gets one mode marker and repeated turns in the same mode get none.
- Tests prove Plan -> Agent -> Plan transitions produce one marker per persisted transition.
- Tests prove Plan -> Agent -> Plan UI toggles without a sent Agent turn do not create an extra Plan marker.
- Tests prove execution-mode markers follow the same transition-only rule.
- Tests prove historical model messages replay exact persisted hidden context without regeneration.
- Tests prove an earlier Plan request remains an exact provider-message prefix after an Agent turn is appended.
- Existing Plan capability, prompt/cache, history, replay, typecheck, and targeted regression tests remain green.

## Scope
Do not change mode-specific model/provider selection, Plan capability policy, or unrelated UI behavior. Do not migrate old history eagerly; legacy conversations without hidden context establish their state on the next sent user turn.
