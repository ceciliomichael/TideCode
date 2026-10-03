# Compaction and Durable State Architecture for Long-Running Agents

## Purpose

Long-running agent systems eventually outgrow the context window of the model that drives them. A naive solution is to summarize old messages and replace them. That is not enough for an agent that edits files, uses tools, changes state, resumes after interruption, or runs for hours or days.

A robust system needs two different forms of continuity:

1. Conversation continuity: enough recent and historical context for the current thread to continue correctly.
2. Durable operational continuity: stable project facts, decisions, constraints, architecture, known failures, and unfinished work that should survive repeated compactions, restarts, and even separate conversations working in the same workspace.

This document describes a reusable architecture for that problem.

The key idea is:

> Never treat compaction as deleting history. Treat it as creating a new model-facing projection of an unchanged canonical history, while separately reconciling durable state that survives future projections.

That separation makes compaction safer, repeatable, auditable, and suitable for long-running agentic systems.

---

## 1. Core Mental Model

A long-running agent should maintain three different layers of state.

### Layer 1: Canonical history

Canonical history is the authoritative event record.

It contains the actual user messages, assistant messages, tool calls, tool results, state changes, compaction commits, failures, aborts, and other execution events.

Canonical history is not reduced just because the model context becomes too large.

It exists for:

- auditability
- recovery
- replay
- undo or branch operations
- debugging
- reconstructing state after restart
- validating that a compacted projection came from real evidence

Think of canonical history as the event log.

### Layer 2: Model-facing replay projection

The replay projection is what is actually sent back to the model on the next step.

Before compaction it may resemble recent canonical conversation history.

After compaction it becomes a much smaller synthetic view containing:

- a compact continuation handoff
- optionally a durable-state snapshot
- important hidden or runtime context that must remain active
- a bounded recent tail of raw conversation messages

This layer is disposable and reconstructable.

Think of it as a materialized view optimized for the model context window.

### Layer 3: Durable state

Durable state stores long-lived facts that remain useful beyond one compaction cycle or one conversation.

Typical durable information includes:

- active goals
- user constraints
- architectural decisions
- important project facts
- completed milestones
- known failures and workarounds
- important files and symbols
- open work

Durable state should not be a transcript and should not accumulate every conversation detail.

It is reconciled state, not chronological history.

Think of it as the agent's durable working memory for a workspace or project.

---

## 2. Why Conversation Summaries Alone Are Not Enough

A single rolling summary has several failure modes.

### Summary drift

Each new summary is generated from an older summary plus newer messages. Small inaccuracies can compound across repeated compactions.

### Lost exact intent

A summary may paraphrase a user instruction and accidentally weaken an important constraint.

### False completion

If compaction occurs while an agent is still working, completed tool calls can make the summarizer incorrectly conclude that the overall request is finished.

### Tool inconsistency

A bad compaction boundary can preserve a tool result without the tool call that produced it, or preserve an unresolved call without its result.

### Cross-conversation amnesia

A thread-local summary does not help another conversation working on the same project.

### Unbounded memory growth

A memory file that simply appends every discovered fact eventually becomes another oversized transcript.

The architecture in this document addresses these problems explicitly.

---

## 3. The Fundamental Invariants

The following invariants should hold in any implementation.

### Invariant 1: Canonical history remains authoritative

Compaction never rewrites the truth of what happened.

The compacted projection is an optimization for model input, not the system of record.

### Invariant 2: Durable state is reconciled, not appended

Each durable-state update produces the complete replacement state.

New evidence may:

- keep an existing item
- update it
- supersede it
- remove it when proven obsolete
- add a new item

Silence is not deletion. An older durable fact remains valid unless newer evidence explicitly changes it.

### Invariant 3: Only safe boundaries may be compacted

Do not split tool-call and tool-result pairs across the compaction boundary.

Do not compact across an unresolved tool transaction.

### Invariant 4: Recent raw context is preserved

The model should retain a bounded recent tail after the handoff so that immediate conversational detail does not depend entirely on a summary.

### Invariant 5: A compaction commit is atomic from the agent's point of view

A compaction should not become the active replay state until:

- durable state has reconciled successfully
- the handoff has validated
- the projected context fits the intended budget
- the resulting checkpoint can be persisted

### Invariant 6: Repeated compaction starts after the previous barrier

After one compaction, later compactions summarize only the evidence added after the previous handoff boundary.

Do not repeatedly resummarize the full lifetime of the conversation.

### Invariant 7: Runtime lifecycle state is authoritative

The host runtime knows whether the latest request is still active, settled, failed, aborted, or blocked.

A summarizer must not infer lifecycle state only from transcript wording.

---

## 4. High-Level Data Flow

A typical long-running loop looks like this:

    User request
        |
        v
    Provider-facing replay
        |
        v
    Model step
        |
        v
    Tool calls and tool results
        |
        v
    Context usage check
        |
        +---- below threshold ----> continue normally
        |
        +---- above threshold ----> compaction pipeline
                                      |
                                      v
                               select safe window
                                      |
                                      v
                              reconcile durable state
                                      |
                                      v
                            generate continuation handoff
                                      |
                                      v
                              validate and project tail
                                      |
                                      v
                              verify projected budget
                                      |
                                      v
                               persist compaction commit
                                      |
                                      v
                            continue from compacted replay

The canonical event history remains intact throughout this process.

---

## 5. Context Budgeting

Compaction should be driven by an explicit model-context budget.

A useful budget includes:

- model context-window size
- static system-prompt tokens
- tool-schema tokens
- replay-message tokens
- reserved output capacity
- configurable compaction trigger ratio
- target retained-history budget

A simple model is:

    total_context =
        system_prompt
        + tool_schemas
        + replay_messages

Trigger compaction when:

    total_context >= context_window * trigger_ratio

Do not trigger based only on message count. Tool outputs, code, images, schemas, and structured data can make two conversations with the same number of messages radically different in size.

### Reserve generation capacity

Do not fill the entire context window with input.

Reserve space for:

- the next assistant response
- reasoning if the provider uses internal reasoning capacity
- tool calls
- provider-specific overhead

### Separate trigger size from retention size

The threshold that starts compaction and the amount retained afterward are different controls.

For example:

- trigger around a configurable percentage of the full context window
- retain only a bounded recent tail plus compact handoff

The projected context should be comfortably below the next trigger, otherwise the system may immediately compact again.

---

## 6. Safe Compaction Windows

The compaction service must decide which old messages can be replaced and which recent messages remain verbatim.

The result is a compaction window:

- source start
- source end
- evicted messages
- retained tail
- optional anchors
- source message identifiers

### Tool-pair safety

For every tool call before the chosen boundary, the corresponding result must also be before that boundary.

Likewise, a result must not appear without its matching call.

A boundary is safe only when the sets match.

Conceptually:

    safe(boundary) =
        tool_calls_before_boundary == tool_results_before_boundary

If unresolved tools exist in the candidate region, postpone compaction or choose a different safe boundary.

### Turn-aware retention

Prefer complete user turns as boundaries.

A recent user request and its ongoing assistant/tool work should normally remain together.

If the newest turn itself is exceptionally large, such as one enormous tool result, the implementation may compact the whole current source only if it can preserve all required evidence in the handoff and does not break tool semantics.

### Previous compaction barrier

For repeated compaction, the new source begins after the previous continuation message.

This creates a sequence of rollover checkpoints rather than recursive resummarization of the entire conversation.

---

## 7. Durable State Reconciliation

Durable state is updated from:

- the previous durable-state snapshot
- newer evidence being evicted from the replay window

The reconciliation worker should return the complete replacement durable state.

It should not return a patch or delta.

### Recommended durable sections

A generic durable-state document can use sections such as:

    ## Active goals
    ## User constraints
    ## Decisions
    ## Important project facts
    ## Current architecture
    ## Completed milestones
    ## Known failures and workarounds
    ## Important files and symbols
    ## Open work

Only include sections that currently contain useful information.

### Reconciliation rules

A durable-state worker should follow rules like these:

1. Keep durable facts that still apply.
2. Update facts when newer evidence changes them.
3. Remove facts only when newer evidence proves them obsolete or explicitly supersedes them.
4. Add newly established durable information.
5. Merge duplicates into one canonical statement.
6. Prefer explicit user instructions and verified tool evidence.
7. Preserve uncertainty when evidence is uncertain.
8. Never promote a guess into a fact.
9. Keep open work separate from completed work.
10. Preserve important exact identifiers such as paths, commands, symbols, model names, branch rules, or test names.
11. Keep the result compact rather than chronological.
12. Treat the previous durable snapshot as authoritative for older facts that the new evidence does not revisit.

### Why complete replacement is important

A replacement model prevents an append-only memory from becoming a pile of stale contradictions.

It also makes the durable state easy to inspect, persist, diff, and inject into future contexts.

---

## 8. Durable State Scope

Durable state should have an explicit scope.

For project-oriented agents, workspace scope is often the most useful:

    workspace
      -> shared durable state
      -> conversation A
      -> conversation B
      -> conversation C

Each conversation may have its own short-term handoff, but all conversations working in the same workspace can read the same reconciled durable state.

Other systems may choose scopes such as:

- repository
- customer account
- task group
- autonomous agent identity
- simulation world
- long-running job

The important rule is that durable memory must have a stable ownership boundary.

Do not mix unrelated projects into the same durable state.

---

## 9. Concurrency and Atomic Durable Updates

If multiple conversations can update the same durable state, updates must be serialized.

A safe pattern is:

1. Acquire a scope-level memory lock.
2. Read the latest durable snapshot inside the lock.
3. Reconcile using that exact snapshot plus newer evidence.
4. Normalize and validate the replacement.
5. Write atomically.
6. Release the lock.

This prevents lost updates such as:

- conversation A reads revision 10
- conversation B reads revision 10
- A writes revision 11
- B writes its own replacement based on revision 10 and silently erases A's update

### Revision identifiers

Each durable snapshot should carry a revision identifier.

The revision can be:

- content hash
- monotonic version
- database revision
- modification time plus size
- commit identifier

A content hash is ideal when practical because it also provides integrity evidence.

---

## 10. Durable Memory Is Not the Handoff

This distinction is essential.

### Durable state

Durable state answers:

> What remains important about this project or workspace across time and conversations?

Examples:

- architectural decisions
- stable constraints
- unfinished milestones
- important files
- established workarounds

### Compaction handoff

The handoff answers:

> What does the next model step need to continue this specific conversation correctly?

Examples:

- what the current user asked
- what was just attempted
- which substeps completed
- what remains open
- current validation status
- failures encountered in this conversation
- immediate next action

Durable state should be stable and cross-conversation.

The handoff should be short-lived and conversation-specific.

Do not collapse these into one document.

---

## 11. Exact User Intent Ledger

Summaries can paraphrase user requests incorrectly.

For high-value long-running workflows, maintain a small ledger of exact historical user prompts or other authoritative intent records.

Each entry can contain:

    prompt
    source_message_ids
    status
    truncated

Possible statuses:

- open
- completed
- superseded
- aborted
- unknown

This ledger should remain bounded.

Keep the newest and most relevant intent records within a token budget.

### Why this matters

A handoff might summarize:

    User asked to improve the export flow.

But the original instruction may have contained an important constraint:

    Do not change the existing file format.

An exact intent ledger gives the continuation model a way to preserve those constraints across repeated compactions.

Historical prompts must be clearly labeled as historical intent, not new instructions.

---

## 12. Active-Turn Protection

Compaction can happen while an agent is still processing the latest user request.

This is dangerous because the transcript may contain many successful actions even though the overall task is incomplete.

The host runtime should provide an explicit turn state such as:

- active
- settled
- failed
- aborted

When the turn is active, the compaction handoff must contain an authoritative guard similar to:

    The latest user request is still in progress.
    Successful tool calls are completed substeps only.
    Continue the overall request from the verified state.

This prevents the summarizer from accidentally converting partial work into completion.

A settled turn only means the execution loop stopped. It does not automatically prove that the user's goal succeeded.

---

## 13. Compaction Handoff Generation

The handoff generator should receive bounded, structured evidence.

Recommended inputs:

- previous handoff
- current durable state
- evicted transcript messages
- exact user-intent ledger
- host turn lifecycle state
- verified tool receipts
- source digest
- source message identifiers

The prompt should explicitly distinguish trusted metadata from untrusted transcript data.

### Do not preserve raw tool history in the handoff

Raw tool arguments and outputs can be enormous.

Instead, convert them into concise evidence:

- file X was modified
- command Y succeeded
- test Z failed with error Q
- API returned status N
- validation remains pending

For particularly important operations, store compact verified receipts rather than the raw payload.

---

## 14. Source Digests and Lineage

Every compaction checkpoint should be traceable to the evidence that produced it.

Store at least:

- compaction ID
- parent compaction ID
- source digest
- source message IDs or sampled source IDs
- source range
- projection version

### Source digest

Compute a stable hash over the exact normalized source being compacted.

This allows the system to detect whether two compactions refer to the same evidence and helps prevent stale results from overwriting newer state.

### Parent linkage

Each compaction packet should link to the previous packet.

This creates a chain:

    packet 1
      -> packet 2
          -> packet 3
              -> packet 4

The chain is useful for:

- replay
- diagnostics
- stale-write prevention
- branch handling
- debugging compaction drift

---

## 15. Building the New Replay Projection

After durable reconciliation and handoff generation, construct the next model-facing projection.

A robust projection usually contains:

1. durable-state context, when not injected by another runtime layer
2. the new continuation handoff
3. required hidden or environment context
4. a bounded recent tail of raw conversation messages

Conceptually:

    projected_replay = [
        durable_state?,
        continuation_handoff,
        runtime_context?,
        recent_tail
    ]

### Strip raw tool history from the retained tail

The recent tail may still contain very large tool calls and tool results.

Before selecting the retained tail, project tool-heavy messages into a safer form or remove raw tool history when the handoff already preserves the verified facts.

### Preserve hidden runtime context

Some systems inject hidden user context such as:

- environment metadata
- selected workspace
- execution mode
- permissions
- external state

If those contexts are still active and are not already present in the retained tail, carry forward the latest value for each context kind.

Do not rely on an old summary to reproduce runtime-controlled context.

---

## 16. Validate Before Commit

A compaction result should be treated as untrusted until validated.

Validation should include:

- non-empty handoff
- expected format
- maximum length
- no forbidden structured wrapper if plain Markdown is required
- no hidden reasoning markup
- no control characters
- safe message shapes
- safe tool-call/result pairing
- durable-state size limit
- projected context budget
- source-lineage consistency

### Fail closed when compaction is required

If the context is already at or above a hard operational threshold and the compacted projection is still too large, continuing blindly may cause the next model request to fail.

A compaction gate should decide whether continuing is safe.

If compaction is optional and fails, the system may continue with the previous replay.

If compaction is required for the next request to fit, do not silently continue with an oversized context.

---

## 17. Compaction Commit

Only after validation should the system activate the new projection.

Persist a compaction-committed event containing enough information to reconstruct the model-facing state later.

Recommended fields:

    compaction_id
    parent_compaction_id
    sequence
    source_digest
    source_message_ids
    source_range
    handoff_packet
    durable_state_revision
    projected_messages
    projection_version
    provider_id
    model_id
    reasoning_retention
    context_fingerprint
    degraded_diagnostics
    used_fallback

The exact schema can vary, but the commit must make replay deterministic.

### Why persist the projected messages

Reconstructing a projection from only the summary may produce a different context after a restart because:

- retention rules changed
- provider adapters changed
- hidden context rules changed
- token estimators changed
- sanitizers changed

Persisting the committed projection gives deterministic recovery.

A newer projection version can intentionally migrate this behavior later.

---

## 18. Replay and Restart Recovery

When an agent process restarts:

1. Load canonical history.
2. Find the latest valid committed compaction for the active branch.
3. Decode and validate the stored projection.
4. Restore the latest durable-state snapshot.
5. Restore the latest compaction packet and lineage.
6. Append canonical events that occurred after the compaction commit.
7. Reinject current runtime-controlled context.
8. Continue from the reconstructed replay.

If the stored projection is invalid or cannot be decoded, fall back to a safer reconstruction path from canonical history.

Never fabricate state merely because a compacted checkpoint is unreadable.

---

## 19. Repeated Compaction

Repeated compaction should behave like rolling checkpoints.

Suppose a conversation evolves as:

    raw history A
      -> compaction 1
      -> raw suffix B
      -> compaction 2
      -> raw suffix C
      -> compaction 3

Compaction 2 should summarize B while carrying forward the validated handoff from compaction 1.

Compaction 3 should summarize C while carrying forward compaction 2.

The canonical log can still contain A, B, and C.

The model-facing replay does not need to replay all of them.

This is the core rollover-memory behavior.

---

## 20. Reasoning Continuity

Providers differ in how reasoning can be preserved.

A generic architecture should record the reasoning-retention mode separately from normal visible history.

Possible modes:

- exact replay
- provider-native replay
- visible summarized reasoning
- unavailable

Do not assume hidden reasoning can be copied across providers.

If a model or provider cannot replay internal reasoning, preserve only the visible decisions, evidence, constraints, and next checks required for correct continuation.

Reasoning continuity should never be allowed to override verified state.

---

## 21. Failure Handling

A long-running system should expect compaction to fail occasionally.

Possible failures include:

- summarizer timeout
- model error
- malformed handoff
- oversized durable state
- invalid tool pairing
- stale compaction result
- process abort
- persistence failure
- lock contention
- projected context still too large

Recommended behavior:

### Before activation

If failure happens before the compaction commit, keep the old replay active.

### After durable reconciliation but before commit

Do not treat the new handoff as active.

The durable update and conversation compaction commit should have a defined consistency policy.

For systems requiring strict transactional guarantees, store both in one transactional database commit.

For filesystem-based systems, use atomic writes, revision checks, and a recoverable event log.

### Stale completion

If a slower compaction finishes after newer conversation state has already committed, reject the stale result using source digests, revisions, sequence numbers, or compare-and-swap rules.

### Aborted run

An abort should not be recorded as successful task completion.

Preserve partial verified work but keep the user goal marked aborted or open according to the host lifecycle.

---

## 22. Concurrency and In-Flight Deduplication

The same compaction may be requested more than once due to:

- multiple runtime clients
- repeated prepare-step hooks
- concurrent UI surfaces
- retries around the same boundary

Create a deterministic in-flight key from fields such as:

    model
    provider
    reasoning configuration
    compaction boundary
    source digest
    parent packet
    durable-state revision
    workspace identity
    retention budget

If another identical compaction is already running, reuse the same promise or job instead of starting a duplicate.

This reduces cost and avoids competing writes.

---

## 23. Security and Trust Boundaries

Transcript text and tool output should be treated as untrusted data during compaction.

A tool result may contain text that looks like instructions to the summarizer.

Use explicit delimiters such as:

    BEGIN UNTRUSTED TRANSCRIPT DATA
    ...
    END UNTRUSTED TRANSCRIPT DATA

The reconciliation and summary system prompts should clearly state that transcript contents are evidence, not higher-priority instructions.

Also:

- strip control characters
- remove hidden reasoning tags
- bound individual tool outputs
- bound total memory size
- validate structured message content
- prevent symlink or path-escape attacks if memory is stored inside a workspace
- never persist secrets merely because they appeared in tool output

---

## 24. Recommended Component Boundaries

A reusable implementation can be divided like this:

    agent/
      compaction/
        budget
        window
        durable-state
        handoff
        intent-ledger
        receipts
        projection
        validation
        gate
        service
      history/
        event-store
        replay-projector
        schemas
      runtime/
        agent-loop
        lifecycle
      memory/
        durable-store
        locking

Responsibilities:

### budget

Estimates model-context usage and decides when compaction is needed.

### window

Finds a safe source region and retained tail.

### durable-state

Reconciles durable project or workspace memory.

### handoff

Generates the short conversation continuation summary.

### intent-ledger

Preserves bounded exact user intent across summary generations.

### receipts

Extracts compact verified facts from important tool executions.

### projection

Builds the new model-facing message sequence.

### validation

Checks handoff, durable state, packet shape, and message integrity.

### gate

Decides whether execution may safely continue after a compaction attempt.

### service

Orchestrates the entire compaction transaction.

### event-store

Persists canonical events and compaction commits.

### replay-projector

Reconstructs the model-facing state after restart or provider change.

### durable-store

Serializes concurrent durable-state updates and writes atomically.

---

## 25. Reference Compaction Transaction

A reusable compaction transaction can be expressed as:

    compact(input):
        budget = calculate_budget(input.current_replay)

        if not forced and budget below trigger:
            return no_compaction

        window = select_safe_window(
            messages = input.current_replay,
            previous_packet = input.previous_packet,
            retention_budget = budget.retention_target
        )

        if no safe window:
            return no_compaction

        source_digest = hash(window.evicted_messages)

        durable_state = update_durable_state_atomically(
            scope = input.workspace,
            reconcile(previous_state, window.evicted_messages)
        )

        handoff = generate_handoff(
            previous_handoff = input.previous_packet,
            durable_state = durable_state,
            evicted_messages = window.evicted_messages,
            runtime_turn_state = input.turn_state,
            intent_ledger = input.intent_ledger,
            verified_receipts = extract_receipts(window.evicted_messages)
        )

        validate(handoff)

        packet = build_packet(
            parent = input.previous_packet,
            source_digest = source_digest,
            source_ids = window.source_ids,
            handoff = handoff,
            intent_ledger = updated_ledger
        )

        projection = build_projection(
            durable_state = durable_state,
            handoff = handoff,
            runtime_context = input.runtime_context,
            recent_tail = window.tail
        )

        validate_projection(projection)

        if projection still exceeds safe budget:
            fail_compaction_gate()

        persist_compaction_commit(packet, projection, durable_state_revision)

        return projection

The runtime only switches to the new projection after the transaction passes validation.

---

## 26. Suggested Durable-State Schema

Markdown is useful because it is:

- human-readable
- model-readable
- easy to diff
- provider-neutral
- easy to persist in files or databases

A generic state may look like:

    ## Active goals

    - Complete the migration without breaking the public API.

    ## User constraints

    - Do not change the persisted file format.

    ## Decisions

    - Use one canonical event log and derive provider replay from it.

    ## Current architecture

    - Runtime state is event-sourced.
    - Durable memory is workspace-scoped.

    ## Completed milestones

    - Added replay recovery after process restart.

    ## Known failures and workarounds

    - Provider X cannot replay native reasoning across sessions.

    ## Important files and symbols

    - src/runtime/agent-loop.ts owns continuation scheduling.

    ## Open work

    - Add stale-compaction rejection using source revisions.

Do not use timestamps on every item unless chronology is necessary to resolve conflicting state.

Prefer current truth over historical accumulation.

---

## 27. Testing Strategy

Compaction needs dedicated regression tests because many failures only appear after long histories.

At minimum test:

### Budgeting

- no premature compaction
- compaction at configured threshold
- static prompt and tool-schema overhead included
- projected replay falls below target

### Boundary safety

- complete tool call/result pairs
- unresolved tool call blocks unsafe boundary
- one very large current turn
- repeated compaction after prior barrier

### Durable reconciliation

- previous facts survive when new evidence is silent
- newer evidence supersedes old facts
- completed work moves out of open work
- uncertainty remains labeled
- duplicate facts merge
- size limits enforced

### Intent preservation

- exact user prompt survives summary paraphrase
- superseded prompts are marked correctly
- active prompt remains open during mid-turn compaction

### Replay

- restart restores the same committed projection
- events after a compaction commit replay correctly
- corrupt projection falls back safely
- provider or model switch does not erase canonical history

### Concurrency

- concurrent durable updates do not lose data
- duplicate compaction requests deduplicate
- stale compaction completion cannot overwrite newer state

### Failure handling

- summarizer timeout
- invalid handoff
- invalid durable-state output
- persistence failure
- abort during compaction
- required compaction that still does not fit

---

## 28. Common Anti-Patterns

Avoid the following designs.

### Delete old messages after summarizing

This destroys auditability and makes recovery dependent on one lossy summary.

### Use one summary as both memory and handoff

Project memory and conversation continuation have different lifetimes and responsibilities.

### Append to memory forever

An append-only memory becomes stale, contradictory, and too large.

### Compact at arbitrary message indexes

This can split tool transactions and corrupt replay semantics.

### Let the summarizer decide whether the task is complete

The runtime lifecycle is more authoritative than prose.

### Trust the summary without validation

Model-generated state must be bounded and validated before activation.

### Compact the entire history every time

Repeated full-history summarization increases cost and drift.

### Store raw tool output in durable memory

Tool output should become compact verified facts.

### Treat historical user prompts as fresh instructions

Intent ledgers must clearly mark historical prompts as evidence about prior intent.

---

## 29. Minimal Version vs Production Version

A minimal viable implementation can start with:

1. canonical append-only event history
2. token-budget trigger
3. safe boundary selection
4. one conversation handoff summary
5. bounded recent raw tail
6. durable workspace Markdown
7. atomic compaction commit
8. restart replay from latest commit

A production-grade implementation should additionally add:

- exact intent ledger
- compaction lineage
- source digests
- in-flight deduplication
- active-turn guard
- durable-memory locking
- stale result rejection
- provider-aware reasoning retention
- hidden runtime-context reinjection
- fallback replay recovery
- compaction versioning
- extensive regression tests

---

## 30. Design Principle Summary

The architecture can be reduced to seven rules:

1. Keep canonical history forever or according to an independent retention policy.
2. Compact only the model-facing projection.
3. Maintain durable state separately from the conversation handoff.
4. Reconcile durable state from previous truth plus newer verified evidence.
5. Compact only at safe execution boundaries.
6. Commit a validated rollover checkpoint with lineage and deterministic replay data.
7. Rehydrate the agent from durable state plus the latest handoff plus a bounded recent tail.

This produces a long-running agent that can keep working beyond a single context window without pretending that a lossy summary is the original history.

---

## 31. Portable Architecture Statement

The following paragraph can be reused as architectural context in another project:

> This agent uses rollover context rather than destructive summarization. Canonical execution history remains authoritative and is never replaced by compaction. When model context approaches its budget, the runtime selects a safe completed-history window, reconciles a separate durable project-state snapshot from previous durable state plus newly evicted evidence, generates a conversation-specific continuation handoff, retains a bounded recent raw tail, validates the resulting model-facing projection, and commits the rollover as a versioned checkpoint with source lineage. Repeated compactions begin after the previous checkpoint. Runtime lifecycle state, verified tool evidence, and exact user intent take precedence over summarizer inference. On restart, the agent reconstructs model context from the latest valid checkpoint and durable state while preserving the full canonical history for audit, recovery, and branching.

That statement captures the essential pattern without depending on any specific agent framework, model provider, storage engine, or user interface.
