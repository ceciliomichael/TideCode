# Repair Code Mode failures from uploaded history

## Goal
Fix the two reproducible Code Mode failures shown in the uploaded history: multiple over-escaped regex literals in one generated program, and Windows EPERM failures when replacing existing files during write/apply_patch.

## Changes
- Make regex syntax recovery iterative so one program can repair more than one over-escaped literal before validation succeeds.
- Add a regression test using both malformed Text\\( filters from the history.
- Add a Windows-safe existing-file replacement fallback to the shared atomic text writer: move the old target to a unique backup, install the staged file, restore on install failure, and remove the backup after success.
- Keep write and apply_patch on the same shared mutation path so both benefit from the fix.

## Verification
- Run the targeted Code Mode regex tests.
- Run mutation reliability tests, including a simulated Windows EPERM replace case.
- Run TypeScript type checking.

## Scope
No changes to unrelated Code Mode permissions, prompt behavior, or workspace mutation semantics.
