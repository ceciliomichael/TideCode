# Plan 029 - Recover mistaken Code Mode tools imports

Status: implemented

## Goal
Prevent provider models from failing Code Mode by trying to dynamically import a tools module even though TideCode already injects tools as a global binding.

## Findings
- The supplied DeepSeek history generated `const { tools } = await import('./tools.js');` before `tools.list(...)`.
- TideCode correctly blocks dynamic module loading for sandbox security, so no inner tool ran.
- The shared Code Mode contract says dynamic imports are blocked, but it does not explicitly state that `tools` is already globally available and must not be imported.

## Implementation
- Strengthen the shared provider-neutral Code Mode contract to say `tools` is pre-injected globally and must be called directly without import/require/setup.
- Add a narrow preflight repair for only the harmless generated boilerplate `const|let|var { tools } = await import('./tools.js')` at the start of a program.
- Remove that declaration before sandbox restriction scanning, while leaving every other dynamic import blocked.

## Security and Reliability
- Do not enable module loading or weaken Node permission restrictions.
- Do not broadly rewrite imports. Only strip the exact tools-binding boilerplate and only when the remaining program directly uses `tools.*`.
- Preserve all existing blocked-runtime behavior for real module imports.

## Verification
- Add a regression reproducing the exact DeepSeek program shape and assert the inner tool executes.
- Keep/add a regression proving arbitrary dynamic imports remain blocked with zero tool calls.
- Run focused Code Mode/prompt tests, TypeScript typecheck, and scoped git diff check.

## Scope
Only Code Mode prompt guidance and narrow preflight recovery for mistaken tools-module imports.
