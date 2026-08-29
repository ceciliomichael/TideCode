# Plan 062: Fix Kanban tool contract discoverability

## Context
A persisted Agent-mode history showed repeated Kanban tool failures before a successful card creation. The model guessed unsupported actions such as `create`, `list`, `get_card`, `get`, and `list_cards`, and initially used `acceptanceCriteria: [{ description: ... }]` instead of the required `text` field. The Kanban store itself worked once the model guessed the valid `create_card` action.

## Root cause
- `kanban_board` exposes `action` as an unconstrained string even though runtime accepts a fixed action vocabulary.
- The tool description is too generic to teach the action contract.
- Code Mode callable-contract rendering truncates enums and collapses nested object shapes to `object`, so nested acceptance criteria are not discoverable.
- Invalid-action errors report only `Unknown action` and do not teach the valid values.

## Implementation
1. Define one canonical Kanban action constant and use it for the schema action enum and runtime invalid-action guidance.
2. Add concise action documentation to the Kanban schema so native and Code Mode consumers receive the exact vocabulary.
3. Improve Code Mode callable-contract formatting so small enums are rendered completely and small nested object/array shapes retain their fields, including acceptance criteria `text`.
4. Keep the contract compact and bounded. Do not add permissive aliases for guessed actions.
5. Add regression tests against the generated Code Mode description, the native Kanban schema action enum, and invalid-action guidance.

## Verification
- Focused Kanban and Code Mode tests.
- Typecheck.
- Targeted ESLint for changed files.
- `git diff --check`.
- Preserve unrelated dirty work and do not commit unless requested.
