# Workspace Bootstrap and Recoverable Inspection

## Goal
Tell the model to read root `AGENTS.md` only when it exists, without injecting its contents, and prevent routine Code Mode inspection mistakes from aborting useful batches.

## Changes
- Persist a revision-aware `workspace_instructions` read bootstrap only while root `AGENTS.md` exists, and instruct the model to reuse an already-read matching revision instead of reading it again.
- Refresh provider projections so deleted instructions leave no active bootstrap.
- Put exact-path discovery guidance in the active Code Mode prompt.
- Make `full_file` ignore paging arguments and cap oversized ordinary read windows at 500 lines.
- Return read-only inspection failures to Code Mode programs as recoverable structured results while keeping mutations strict.

## Verification
- Cover existing, unchanged, changed, and missing `AGENTS.md`; Plan Mode persistence and continuations; oversized/full-file reads; and mixed successful/missing-path batches.
- Run focused tests, type checking, linting, and diff validation.

## Scope
- Root `AGENTS.md` only; no automatic path substitution, nested instruction discovery, or new dependencies.
