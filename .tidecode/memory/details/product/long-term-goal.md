# TideCode Long-Term Product Goal

## North-star outcome

TideCode should become a calm, trustworthy command center for real software work: the assistant, project files, terminal, plan board, source control, model configuration, and durable project context should work together without forcing the user to constantly switch tools.

The measure of success is not simply faster model output. The workspace should help the user move from intent to understanding, from understanding to a deliberate plan, from plan to inspectable changes, and from changes to verification and review.

## Product principles

1. **Clarity over speed for its own sake**: keep the goal and current state visible.
2. **Continuity over disposable chat**: conversations, project folders, canonical history, checkpoints, and workspace memory should help work continue across sessions.
3. **Action with human control**: distinguish planning from acting and keep consequential operations reviewable.
4. **Inspectability by default**: show files, diffs, terminal output, task state, and model/tool context clearly enough for the user to judge the result.
5. **Local-first boundaries**: keep project organization and durable context close to the user’s machine, while making provider/network use explicit.
6. **Provider flexibility**: support Codex, API-key providers, custom models, MCP servers, and skills without making the core workspace depend on one model vendor.
7. **Safe capability access**: give the assistant narrow, validated tools instead of unrestricted access to the operating system.
8. **Leave the workspace clearer**: completed work should improve understanding, organization, and traceability rather than add hidden state.

## Long-running assistant goal

The assistant should build an accurate, revisable model of the project over time. It should remember durable facts that future work will need, but should not treat stale memory as truth. Before relying on a memory entry, verify it against the current repository. When the code or user decision changes, update the relevant memory entry rather than accumulating contradictory notes.

The assistant’s durable memory should prioritize:

- project architecture and important boundaries;
- user-confirmed product decisions;
- non-obvious persistence, migration, and compatibility constraints;
- recurring verification commands and known failure modes;
- security invariants and authorization boundaries;
- resolved bugs whose cause/workaround matters later;
- stable workflow preferences explicitly confirmed by the user.

It should not store secrets, credentials, personal data, hidden reasoning, routine turn narration, speculative guesses, or facts that are obvious from nearby source code and have no future decision value.

## Intended future behavior

For a substantial change, the assistant should be able to:

1. Read the relevant project memory and current source evidence.
2. State or infer the smallest complete objective.
3. Plan the change across the correct module boundaries.
4. Implement it without bypassing safety contracts.
5. Verify focused behavior and proportionate project checks.
6. Update durable memory only when the result establishes reusable knowledge.
7. Leave a concise, accurate record of what changed and what was actually verified.

This goal is intentionally broader than any single feature. It describes the continuity and trust model the project should preserve while the implementation evolves.

Source basis: `README.md` and `docs/project-documentation.md`, supplemented by the current Electron/React architecture. Verified August 11, 2026.
