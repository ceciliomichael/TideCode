# Long-Running Agent Context Compression and Continuity

A provider-independent account of the compression architecture used by TideCode, adapted for general-purpose long-running agents.

## 1. Purpose

A long-running agent can accumulate more conversation, observations, decisions, actions, and intermediate results than a model can accept in one request. Compression allows it to continue without repeatedly loading its complete history. The aim is not simply a shorter transcript. The aim is **continuity of intent, facts, obligations, and execution state** while reducing model-facing tokens.

TideCode calls this process *compaction*. Its central pattern is to preserve historical records while building a smaller context projection for the next model request.

## 2. The Three-State Model

**Canonical history** is the historical source of truth. Record messages, requests, observations, tool operations, outcomes, failures, interruptions, and compaction checkpoints. A summary must not replace this record. Historical evidence may be needed for audits, recovery, branching, or correction.

**Continuation handoff** is a concise statement of what the agent needs *now*: the active goal, relevant constraints, progress supported by evidence, outstanding obligations, blockers, and next actions. It is a working-state snapshot, not a permanent knowledge base or a chronological transcript.

**Durable memory** is a compact, separately maintained body of longer-lived knowledge. It contains stable preferences, decisions, persistent facts, learned constraints, and important ongoing commitments. It must be reconciled as facts change instead of endlessly appended. TideCode's current implementation scopes this durable memory **to the individual conversation**, not automatically to every conversation in a workspace.

These layers serve different purposes and should not be merged. A fourth practical component, the **recent raw tail**, retains a bounded selection of recent original interactions for high-fidelity local context.

## 3. End-to-End Flow

```text
Incoming request or ongoing agent step
                 |
       Assemble current context
                 |
      Estimate total token usage
                 |
       Below configured trigger? ---- yes ---> Continue normally
                 |
                no
                 |
      Find a safe compression boundary
                 |
       No safe reduction possible? ---- yes ---> Preserve state; stop or
                 |                              use explicit recovery policy
                no
                 |
       Gather post-barrier evidence
                 |
       Reconcile durable memory
                 |
       Generate continuation handoff
                 |
       Validate handoff and provenance
                 |
       Rebuild constrained model context:
         memory pointer + handoff +
         active runtime instructions +
         bounded recent raw interactions
                 |
       Verify reconstructed token budget
                 |
       Atomically persist checkpoint
                 |
          Resume agent execution
```

### Step 1. Measure context pressure

Estimate the cost of the messages, agent instructions, tool descriptions, and retained evidence. Keep enough headroom for response generation. TideCode compares estimated total usage against a configurable percentage of the **full** model context window. It separately reserves output capacity and derives a smaller retention budget.

Estimates are approximate, not a guarantee of provider-side token accounting. Re-evaluate at every relevant continuation rather than relying on a single estimate from the first request.

### Step 2. Choose an admissible compression window

Prefer a boundary between complete interactions or action transactions. Do not leave an action invocation without its corresponding observation, or vice versa. Reject compression when unresolved action/result relationships make the candidate unsafe.

Preserve the newest user request and relevant recent evidence wherever the budget permits. Older history is summarized, while a limited tail remains verbatim. TideCode can also compact a single oversized interaction by retaining a bounded representation of its evidence.

### Step 3. Separate new evidence from previous summaries

After the first compression, identify the previous compression boundary. Feed **new evidence since that boundary** to the next reconciliation. Include the previous durable memory and previous handoff as context, without repeatedly treating the entire lifetime transcript as new evidence.

This limits repeated re-summarization and compounding summary drift. Historical source IDs and a digest make it possible to associate the new checkpoint with the material it summarizes.

### Step 4. Reconcile durable memory first

A distinct model pass updates the durable knowledge snapshot. Inputs include prior memory, the previous handoff, current execution status, and newer transcript evidence.

The output is a **complete replacement memory**, not a list of additions. Retain still-valid facts, revise contradicted facts, remove proven obsolete entries, and add well-supported new facts. Do not infer deletion merely because an earlier fact was not mentioned recently.

Keep memory concise, scoped, and bounded. Treat untrusted observations and quoted text as evidence, not instructions. Validate its output before committing any compression.

### Step 5. Generate a current continuation handoff

A second model pass produces a short, standalone Markdown handoff. It sees the reconciled memory, previous handoff, current lifecycle status, and new observations.

The handoff should answer:

- What is the agent trying to achieve now?
- Which instructions and constraints remain binding?
- What has been completed, and what evidence confirms it?
- Which operations failed or were interrupted?
- What is unresolved, including external dependencies?
- What must happen next, without duplicating finished work?

A summarizer must not declare work completed merely because several intermediate operations succeeded. The host runtime's active, settled, aborted, or failed status is more authoritative than the model's inference. When the turn is still active, explicitly mark compression as an intermediate checkpoint.

### Step 6. Validate, then project

Reject empty, malformed, excessively large, or otherwise invalid output. Preserve important evidence and exact user intent using a separate bounded historical-intent ledger when needed. Such historical prompts are context, **not** renewed instructions, reopened work, or fresh approval.

Construct the next model-facing context from:
1. A reference or instruction to obtain scoped durable memory.
2. The continuation handoff.
3. Re-established runtime policies, active instructions, and necessary environment context.
4. A bounded, sanitized tail of recent interactions.

TideCode's current per-chat memory mechanism tells the model to read `@chat/DURABLE.md` using the file-reading tool; it does not merely paste the entire memory into each compacted replay. A different agent can instead use a structured memory fetch API, provided read permissions and memory scope are explicit.

Recalculate the resulting size. A compression result that still exceeds the retention budget is not a valid checkpoint.

### Step 7. Commit and resume

Persist the validated handoff, memory snapshot, source provenance, and reconstructed context together as a checkpoint. Only then switch active replay to the new projection. Continue the current operation if the runtime says it is still active.

TideCode also deduplicates matching in-flight compression requests, supports forced/manual compaction, and records compaction events for later replay. Its history projection can reconstruct replay from stored packets when the preferred projection is unavailable.

## 4. What Should Survive Compression?

| Preserve | Why |
| --- | --- |
| Latest explicit request and current goal | Prevent working on a stale objective |
| Non-negotiable user constraints | Avoid silent changes in scope or behavior |
| Confirmed decisions and long-lived preferences | Keep continuity across many cycles |
| Active task status and unfinished obligations | Prevent false completion |
| Successful operations with supporting evidence | Avoid duplicate work or invented results |
| Failures, blockers, pending external actions | Enable safe recovery |
| Relevant entity identifiers and source references | Support verification and targeted retrieval |
| Recent original dialogue and observations | Retain nuance that summaries may miss |
| Runtime policies and permissions | Avoid losing authority boundaries |
| Source provenance and checkpoint parentage | Enable audit and reconstruction |

Usually omit verbose historical reasoning, duplicate observations, obsolete temporary plans, bulky raw outputs, and incidental details with no future value. Preserve important raw evidence in canonical storage, not necessarily in model context.

## 5. Memory Versus Handoff

**Durable memory** answers: "What should this agent continue to know?"

**Continuation handoff** answers: "What must this agent do next, given what happened?"

For example, a travel concierge's durable memory might contain a user's preferred pace, accessibility requirements, and confirmed itinerary constraints. Its handoff might contain the hotel currently awaiting confirmation, the last verified reservation status, and the next step. The conversation log retains the complete reservation history and provider responses.

A personal assistant could use the same separation for recurring commitments; a research agent for evolving hypotheses and cited findings; an operations agent for incidents and pending actions. No software-development-specific concept is required.

## 6. Reliability and Safety Rules

1. **History is immutable evidence.** Compression changes what the model sees, not what happened.
2. **Memory is a reconciled snapshot.** An omitted fact does not automatically become false.
3. **Never divide an unresolved transaction.** Maintain complete action/observation relationships.
4. **Preserve user intent exactly where it matters.** Distinguish past requests from current approvals.
5. **Do not hallucinate completion.** Lifecycle status and verified results take precedence.
6. **Reintroduce current authority.** Runtime instructions, permissions, and safety constraints must remain active.
7. **Bound every layer.** Memory, handoff, recent tail, and total projection have separate limits.
8. **Commit atomically.** Failed generation or validation must not replace the last valid projection.
9. **Track provenance.** Source ranges, digests, and checkpoint lineage make recovery possible.
10. **Treat transcript content as untrusted.** Do not promote quoted or tool-supplied text into system authority.
11. **Avoid cross-agent memory leakage.** Enforce explicit boundaries between conversation, user, team, and workspace scopes.
12. **Prefer explicit failure over silent state loss.** If safe compaction cannot fit, report the constraint and preserve recoverable state.

## 7. Repeated Compression Over Days or Months

The first compression produces a durable memory snapshot and a handoff from accumulated evidence. Further interactions add new events to canonical history. At the next threshold, the agent reconciles its last memory and handoff with events after the previous barrier, produces a replacement snapshot and handoff, and keeps a new bounded recent tail.

This becomes a chain of checkpoints rather than a chain of summaries copied verbatim into one another. A later agent can retrieve deeper historical evidence by reference when the compact representation is insufficient. Retrieval is an extension to the design, not a claim that all relevant details survive every summarization.

## 8. Suggested Portable Data Contract

This is a generalized integration suggestion, **not a literal TideCode schema**:

```json
{
  "checkpoint_id": "unique-id",
  "parent_checkpoint_id": "previous-id-or-null",
  "scope": {"agent_id": "agent", "conversation_id": "thread"},
  "source": {"from_event": 0, "through_event": 125, "digest": "hash"},
  "lifecycle": "active",
  "durable_memory": "Replacement knowledge snapshot",
  "continuation_handoff": "Current goal, progress, open work, next actions",
  "recent_event_refs": ["event-121", "event-125"],
  "validated": true
}
```

Canonical events remain stored outside this checkpoint. Validation must include structural integrity, permission scope, safe action boundaries, and an actual context-budget check.

## 9. Implementation Checklist for Another Agent

- Create an append-only, auditable history store.
- Track lifecycle and pending actions independently from conversational text.
- Estimate tokens before each model continuation.
- Decide compression eligibility using safe transaction boundaries.
- Keep previous checkpoint provenance and identify new events after its barrier.
- Reconcile durable knowledge using the previous full snapshot and recent evidence.
- Generate a bounded continuation handoff with explicit unfinished work.
- Validate both outputs and calculate the new context size.
- Reapply runtime instructions and retain a limited recent raw tail.
- Persist the checkpoint atomically and resume from it.
- Test repeated cycles, interruptions, malformed summaries, oversized inputs, stale facts, orphaned tool results, restart recovery, and cross-scope isolation.

## 10. What TideCode Implements Versus What This Document Generalizes

**Observed in the current source:** configurable threshold-based compaction; step-level eligibility checks; safe action boundaries; retention budgets; separate AI-generated durable-memory and handoff passes; per-chat durable memory accessed through a read instruction; preservation of recent interactions; handoff validation; source digests and parent checkpoint IDs; persisted compaction events; manual compaction; replay projection and recovery mechanisms.

**Design guidance for other agents:** the provider-neutral event schema, general-purpose memory scope model, illustrative data contract, and proposed integration checklist are recommendations derived from the implementation, not claims of preexisting TideCode APIs.

**Important distinction:** older project design documents discuss shared workspace-level durable knowledge and proposed implementation stages. The current code examined for this document uses per-conversation durable memory. Do not assume the older design description is the present runtime.

## 11. Source Map for Auditing the TideCode Implementation

- `electron/chat/shared/compaction/budget.ts`: pressure estimates and threshold math
- `electron/chat/shared/compaction/automatic.ts`: live step trigger classification
- `electron/chat/shared/compaction/window.ts`: boundary and recent-tail selection
- `electron/chat/shared/compaction/durableMemory.ts`: memory reconciliation and read pointer
- `electron/chat/shared/compaction/prompt.ts`: handoff worker input
- `electron/chat/shared/compaction/service.ts`: reconciliation, summarization, validation, and projection orchestration
- `electron/chat/shared/compaction/projection.ts`: next model-visible context
- `electron/chat/shared/compaction/gate.ts`: stop when required safe compaction is unavailable
- `electron/chat/shared/compaction/manual.ts`: explicit compression entry point and commit
- `electron/chat/history/eventStore.ts`: canonical event/checkpoint persistence
- `electron/chat/history/replayProjector.ts`: restart/replay projection

This is a conceptual transfer document. Exact prompt templates, numeric limits, storage paths, and provider details should be adapted to the target agent's operating environment.
