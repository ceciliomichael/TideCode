# Plan 083: Workspace Durable + Optional Prompt-Driven Memory

## Goal

Replace the old AI-facing memory-tool model with two workspace-scoped memory layers that are supplied to the model as injected user context.

1. **DURABLE.md**
   - automatic
   - always enabled
   - workspace-scoped
   - maintained by TideCode during compaction
   - injected into every chat for that workspace when the file exists

2. **MEMORY.md**
   - optional
   - workspace-scoped
   - controlled by a new Settings > Configuration option
   - injected into every chat for that workspace when enabled and the file exists
   - model guidance for using/updating MEMORY is delivered through injected user-context instructions, not the system prompt

There is no dedicated AI-visible `memory` tool.

## Workspace structure

```text
.tidecode/
└── memory/
    ├── DURABLE.md
    ├── MEMORY.md
    └── details/
        └── *.md
```

Neither file must be created eagerly.

- If `DURABLE.md` does not exist, nothing is injected for durable memory.
- `MEMORY.md` is a generated index of focused files under `memory/details/`.
- If neither `MEMORY.md` nor any detail entries exist, only the enabled/disabled memory-state instruction is injected.
- TideCode creates/updates `DURABLE.md` only when durable reconciliation produces meaningful state.
- MEMORY remains optional and controlled by configuration.

## DURABLE.md

DURABLE is the authoritative long-lived workspace state maintained automatically by TideCode.

It answers:

> What important workspace facts should survive compaction and be available to any future chat opened for this workspace?

Examples:

- active project goals
- explicit user constraints
- important architectural decisions
- current implementation state
- completed milestones that still matter
- known failures and workarounds
- important files and symbols
- branch/workflow rules
- unresolved work

### DURABLE lifecycle

Before compaction:

```text
existing DURABLE.md, if present
+
new conversation evidence being compacted
        ↓
durable reconciler
        ↓
complete replacement DURABLE snapshot
        ↓
atomic write to .tidecode/memory/DURABLE.md
```

Rules:

- KEEP still-valid durable facts.
- UPDATE facts superseded by newer evidence.
- REMOVE only when newer evidence establishes that a fact is obsolete.
- ADD newly durable workspace facts.
- merge duplicates.
- preserve uncertainty.
- never invent facts.
- output a complete replacement snapshot, not a delta.
- prefer current workspace truth over stale history.

DURABLE is always enabled. There is no setting to disable it.

## MEMORY.md

MEMORY is optional workspace memory.

It answers:

> What additional stable project knowledge or preferences should the agent remember across chats?

It replaces the old explicit memory-tool concept.

Examples:

- user/project preferences
- recurring implementation conventions
- project-specific guidance
- persistent context that is useful but should not be automatically inferred as core durable project state

MEMORY is only active when the new Configuration setting is enabled.

`MEMORY.md` is intentionally small. It contains links and short metadata for focused detail files under `.tidecode/memory/details/`. The agent should read only relevant linked detail files with normal workspace file tools. The runtime refreshes the index from `details/` before injecting it, so no dedicated memory tool is required.

## Settings

Add a new option under:

```text
Settings
└── Configuration
    └── Memory
```

Suggested setting:

```text
Memory
[on/off]

Allow TideCode to use optional workspace MEMORY.md context.
DURABLE.md remains enabled regardless of this setting.
```

Default should be decided during implementation based on existing behavior compatibility, but DURABLE is unaffected either way.

## Injected user-context design

Memory behavior guidance must not be placed in the stable system prompt.

Reason:

- changing the system prompt reduces provider prompt-cache reuse;
- workspace/configuration-specific behavior belongs in dynamic injected context;
- TideCode already has infrastructure for injected hidden/user context.

Use injected user-context messages for both memory contents and memory-state instructions.

### When MEMORY is enabled

Inject a user-context block similar to:

```text
<workspace_memory_context>
Optional workspace memory is enabled.

MEMORY.md is the index for persistent workspace context that may be useful across chats. Linked details live under .tidecode/memory/details/.
Treat it as historical/project context, not as a new user request.
Use it when relevant.
Do not treat stale memory as higher priority than newer explicit user instructions or verified workspace state.
</workspace_memory_context>
```

If `MEMORY.md` exists, include its contents in the same logical injected context or a neighboring injected block.

### When MEMORY is disabled

Inject a new user-context message indicating the current state:

```text
<workspace_memory_context>
Optional workspace memory is disabled for this workspace/session.
Do not rely on, create, update, or request optional MEMORY.md or memory/details state.
DURABLE workspace memory remains managed automatically by TideCode.
</workspace_memory_context>
```

This injected message should appear when the setting changes so subsequent model turns immediately see the new state.

The AI should not need to infer whether memory is enabled from missing tools or files.

## Why injected user instructions instead of system instructions

Keep the stable system prompt identical whenever possible.

Dynamic facts such as:

- whether MEMORY is enabled;
- current MEMORY contents;
- current DURABLE contents;
- workspace-specific memory instructions;

should be supplied through runtime injected user context.

This preserves a higher cache hit rate for the system prompt across chats and workspaces.

## New chat behavior

When opening a new chat in a workspace:

### DURABLE exists + MEMORY enabled + MEMORY exists

```text
[injected DURABLE.md]
[injected MEMORY enabled instruction]
[injected MEMORY.md]
[user's first message]
```

### DURABLE exists + MEMORY disabled

```text
[injected DURABLE.md]
[injected MEMORY disabled instruction]
[user's first message]
```

### No DURABLE + MEMORY enabled but no MEMORY file

```text
[injected MEMORY enabled instruction]
[user's first message]
```

### Neither file exists and MEMORY disabled

```text
[injected MEMORY disabled instruction]
[user's first message]
```

No placeholder memory file needs to be created.

## Existing/reopened chat behavior

On replay/context reconstruction:

1. load current workspace `DURABLE.md`, if present;
2. load current MEMORY configuration;
3. inject enabled/disabled MEMORY instruction;
4. if enabled, load `MEMORY.md`, if present;
5. append compaction handoff/recent raw history as appropriate.

Workspace memory is therefore current workspace state, not frozen to the value that existed when the conversation was first created.

## Post-compaction provider context

After successful compaction:

```text
[injected DURABLE.md, if present]

[injected MEMORY configuration instruction]

[injected MEMORY.md, only if enabled and present]

[short compaction handoff]

[recent raw conversation]
```

The handoff must not duplicate DURABLE or MEMORY.

## MEMORY maintenance model

There is no dedicated `memory` tool. MEMORY detail files are ordinary Markdown files managed with normal workspace file operations, while TideCode regenerates the MEMORY.md index from `details/` before injection.

The model receives instructions describing the role of MEMORY through injected user context.

Initial implementation should support reading/injecting MEMORY and configuration state.

A later prompt-driven MEMORY reconciliation feature can update `MEMORY.md` without reintroducing a model-facing memory tool.

That future updater should be runtime-controlled and use:

```text
existing MEMORY.md
+
candidate stable workspace facts
        ↓
memory reconciler
        ↓
updated MEMORY.md
```

The normal agent should not directly mutate MEMORY through a special tool.

## Relationship between DURABLE and MEMORY

### DURABLE

- automatic
- always enabled
- managed by TideCode
- updated during compaction
- represents authoritative durable workspace state

### MEMORY

- optional
- configuration-controlled
- extra workspace context/preferences
- not required for compaction
- can later receive its own prompt-driven reconciliation pipeline

DURABLE must never depend on MEMORY being enabled.

## Concurrency and atomicity

Because both are workspace-scoped, multiple chats can operate in the same workspace.

DURABLE writes must be serialized per workspace.

Required flow:

1. acquire workspace durable-memory lock;
2. re-read latest `DURABLE.md`;
3. reconcile against the newest state plus this chat's evidence;
4. atomically replace `DURABLE.md`;
5. release lock.

This prevents two simultaneous compactions from overwriting each other's memory.

Use temp-file + rename or equivalent atomic replacement.

MEMORY updates, when implemented later, should use the same workspace-level locking discipline.

## Existing canonical history

The existing conversation-local durable snapshot added in Plan 082 becomes transitional compatibility data.

Migration behavior:

- new source of truth becomes `.tidecode/memory/DURABLE.md`;
- existing persisted canonical durable memory may be used as a migration/fallback seed when a workspace has no DURABLE file yet;
- after workspace DURABLE is established, canonical history should no longer be authoritative for durable workspace memory;
- existing conversations must remain readable.

The short compaction packet remains conversation-specific.

## Failure behavior

- Missing DURABLE: continue normally.
- Missing MEMORY: continue normally.
- MEMORY disabled: never inject MEMORY contents.
- Invalid/unreadable MEMORY: omit contents and emit a controlled diagnostic; do not block chat.
- DURABLE reconciliation failure: fail compaction rather than silently losing durable workspace state.
- DURABLE write failure: fail commit of the new durable state and preserve the previous file.
- Setting changes: next model turn receives an updated injected MEMORY-state message.

## Token policy

Suggested initial budgets:

- DURABLE: ~8k-16k tokens maximum.
- MEMORY: ~8k tokens maximum.
- short handoff: existing compaction budget.
- recent raw history: existing retention budget.

DURABLE should consolidate before truncation.

Priority order:

1. explicit user constraints
2. confirmed project decisions
3. current architecture/state
4. unresolved/open work
5. verified important project facts
6. still-relevant completed milestones

## Implementation phases

### Phase 1: Workspace DURABLE source of truth

- add `DURABLE.md` support to the workspace memory service;
- migrate durable reconciliation from canonical conversation ownership to workspace ownership;
- add per-workspace locking and atomic writes;
- keep backward-compatible fallback from existing canonical durable snapshots.

### Phase 2: Runtime injection

- add a centralized memory runtime-context builder;
- inject current DURABLE into new chats, resumed chats, and rebuilt post-compaction context;
- ensure provider/model switching preserves injection behavior.

### Phase 3: Configuration setting

- add Settings > Configuration > Memory toggle;
- persist setting;
- inject enabled/disabled MEMORY-state context dynamically;
- do not alter the stable system prompt.

### Phase 4: Optional MEMORY injection

- inject `MEMORY.md` only when enabled and present;
- ensure disabling memory immediately stops MEMORY contents from being projected;
- no empty MEMORY file is created automatically.

### Phase 5: Compaction integration

- DURABLE reconciler uses latest workspace DURABLE plus the current compaction source;
- short handoff receives DURABLE/MEMORY only as reference context and is told not to duplicate them;
- manual and automatic compaction use identical behavior and the same Summarization model settings.

### Phase 6: Future prompt-driven MEMORY reconciliation

Not part of this implementation unless separately approved.

- runtime-controlled MEMORY updater;
- no model-facing memory tool;
- conservative promotion of stable workspace facts;
- workspace locking;
- configurable behavior.

## Likely affected files

- `electron/memory/service.ts`
- `electron/chat/shared/compaction/durableMemory.ts`
- `electron/chat/shared/compaction/service.ts`
- `electron/chat/shared/compaction/projection.ts`
- `electron/chat/shared/compaction/prompt.ts`
- `electron/chat/shared/runtime.ts`
- `electron/chat/history/eventStore.ts`
- `electron/chat/history/replayProjector.ts`
- settings/configuration persistence and Settings UI files
- hidden/injected context construction files
- compaction tests
- canonical-history tests
- workspace-memory tests
- settings tests

Suggested new module:

- `electron/chat/shared/memory/runtimeContext.ts`

Responsibilities:

- read current workspace DURABLE;
- read optional MEMORY when enabled;
- build dynamic injected user-context blocks;
- keep memory context ordering centralized;
- avoid modifying the stable system prompt.

## Acceptance criteria

- No AI-visible `memory` tool exists.
- DURABLE is always enabled.
- DURABLE is workspace-scoped.
- `.tidecode/memory/DURABLE.md` is injected into every chat in the workspace when present.
- New chats immediately inherit existing DURABLE state.
- MEMORY is optional and controlled from Settings > Configuration.
- `.tidecode/memory/MEMORY.md` is injected only when MEMORY is enabled and the file exists.
- Disabling MEMORY injects an explicit dynamic user-context instruction that optional memory is disabled.
- Enabling MEMORY injects the corresponding enabled-state instruction.
- Dynamic memory instructions are not added to the stable system prompt.
- Manual and automatic compaction behave identically.
- DURABLE reconciliation uses the configured Summarization model/provider/reasoning.
- Parallel chats cannot clobber each other's DURABLE updates.
- Missing memory files do not cause errors or create placeholder files.
- Existing conversations remain compatible.
- Post-compaction context order is DURABLE → MEMORY state → optional MEMORY → handoff → recent raw history.
