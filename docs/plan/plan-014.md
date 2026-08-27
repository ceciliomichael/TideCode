Status: implemented

# Plan 014: Repair Payload-Only Code Mode Patch Calls

## Goal
Prevent a model-generated code_mode call that contains only payloads.patch from surfacing a failed tool invocation when the intended operation is unambiguous.

## Changes
- Extend the existing Code Mode tool-call repair boundary to recognize toolName `code_mode` with missing/blank code and a valid string `payloads.patch`.
- Synthesize the canonical `tools.apply_patch({ patch: payloads.patch.split('\n') })` program and preserve the string payloads.
- Keep repair narrow: do not infer behavior for other payload names, malformed payload objects, non-string patch data, nonempty code, or unrelated malformed calls.
- Leave patch parsing/matching and provider tool schemas unchanged.

## Reliability and safety
- Repair only a deterministic malformed shape observed in history.
- Continue letting the normal Code Mode and apply_patch validators enforce all execution and workspace safety rules.
- Do not touch unrelated dirty files.

## Verification
- Add regression coverage reproducing the payload-only history call.
- Verify blank-code patch calls repair, while unrelated payload-only calls and valid code calls are not rewritten.
- Run focused Code Mode repair/apply_patch tests, npm run typecheck, and scoped git diff --check.
