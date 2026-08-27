# Plan 030 - Reliable multi-file apply_patch persistence on Windows

Status: implemented

## Goal
Fix the multi-file `apply_patch` failure that produced Windows `UNKNOWN ... open` errors and a misleading rollback failure.

## Findings
- The failed history call parsed and staged both files correctly. The failure happened during persistence, not patch matching.
- `apply_patch` writes targets directly with `fs.writeFile`, unlike `edit` and `write`, which use TideCode's atomic mutation helper.
- On failure, `apply_patch` currently restores every snapshot, including files that were never mutated. That caused the untouched second file to appear as a rollback failure.

## Implementation
- Route patch file writes and snapshot restoration through the shared atomic text writer.
- Add bounded retries for transient filesystem errors such as Windows `UNKNOWN`, `EBUSY`, `EPERM`, and `EACCES` around atomic install/open/read operations where retry is safe.
- Track successfully mutated paths during a multi-file commit and rollback only those paths, in reverse order.
- Keep patch parsing, matching, presentation, and provider contracts unchanged.

## Reliability and Security
- Retries are bounded and limited to transient filesystem error codes.
- Atomic sibling-temp-file replacement avoids opening the existing target for direct truncating writes.
- A failed later file restores only earlier files that were actually committed. Untouched files are never rewritten during rollback.
- No dependencies or sandbox changes.

## Verification
- Add a regression that injects a transient/persistent Windows-style `UNKNOWN` install failure in a two-file patch and verifies the first file rolls back, the second remains untouched, and no false rollback failure is reported.
- Verify transient retries recover when the operation becomes available.
- Run focused apply-patch/mutation tests, TypeScript typecheck, and scoped `git diff --check`.

## Scope
Only shared filesystem persistence used by workspace mutations and the multi-file apply-patch commit/rollback path.
