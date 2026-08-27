Status: implemented

# Plan 012: Simplify Patch Presentation and Revision Handling

## Goal
Show each apply_patch update hunk as its own edit block and remove revision SHA plumbing from the AI-facing workspace tool surface.

## Implementation
- Keep patch execution atomic and file-level summary counts unchanged.
- Preserve each parsed @@ update chunk as a separate change_diff presentation item so repeated hunks in one file render as separate edit blocks in patch order.
- Keep add/delete operations as one block each and preserve move presentation as delete + add.
- Remove revision hashes from read result semantics and patch mismatch messages.
- Remove expectedRevision from the AI-facing edit/write schemas and descriptions, while retaining lower-level revision checks for internal callers that explicitly provide a revision.
- Update focused tests for multi-hunk presentation and the simplified public contracts.

## Reliability and Safety
Patch matching, atomic preflight/commit behavior, exact edit matching, mutation queues, checkpoints, and internal revision conflict support remain intact. No new dependencies are added.

## Verification
Run the focused apply-patch, mutation reliability, agent-tool, and tool-presentation tests, then npm run typecheck and scoped git diff --check.

## Scope
Only patch edit-block presentation and model-facing revision complexity are changing. No unrelated mutation behavior or UI redesign is included.
