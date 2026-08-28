# Code Mode literal apply_patch transport

## Goal
Make TideCode's in-app Code Mode apply_patch transport preserve patch source literally, matching the reliability behavior verified in tidecode-fs-mcp-go.

## Changes
- Normalize complete JavaScript template literals that are actually passed to tools.apply_patch before Code Mode validation/execution.
- Preserve backslash sequences such as \n, \t, \r, \xNN, \uNNNN, regex escapes, Windows paths, and line continuations as patch data.
- Keep compatibility for escaped backticks and escaped template interpolation markers used to safely spell nested patch source.
- Do not rewrite unrelated templates that merely contain patch markers.
- Make the legacy patch-array syntax repair preserve the same literal backslash contract.
- Update model-facing apply_patch guidance to state that patch source does not need double escaping.

## Verification
- Add end-to-end Code Mode apply_patch regression coverage for literal backslash sequences.
- Add a guard that unrelated patch-looking templates retain normal JavaScript interpolation.
- Run focused Code Mode/apply_patch tests, TypeScript typecheck, targeted ESLint, git diff --check, and the full test suite.

## Scope
No changes to patch matching, transaction/rollback behavior, file mutation semantics, UI behavior, or unrelated Code Mode syntax repair.