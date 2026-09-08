# Direct provider-facing write and apply_patch

## Goal
Expose Tidecode's existing write and apply_patch engines as direct provider-facing tools alongside code_mode, so complete file contents and patch text never need to be embedded in Code Mode source. Keep the general opaque payloads sidecar for arbitrary data needed by the remaining inner Code Mode capabilities.

## Changes
- In agent Code Mode orchestration, expose exactly three Tidecode-owned provider tools: code_mode, apply_patch, and write.
- Reuse the existing native apply_patch and write implementations and schemas; do not duplicate mutation logic.
- Remove apply_patch and write from the inner Code Mode registry so patch/file-content transport cannot fall back into JavaScript source nesting.
- Keep payloads as a read-only optional Code Mode sidecar for arbitrary data needed by remaining inner tools (for example terminal input or connected capabilities). Do not use payloads for direct write/apply_patch.
- Update Code Mode provider-boundary guidance so targeted patches use direct apply_patch and complete-file creation/replacement uses direct write.
- Keep Plan Mode's existing tool restrictions unchanged unless current behavior already exposes apply_patch.
- Update provider/tool repair tests so direct apply_patch/write are not misrouted back into code_mode.

## Verification
- Focused agent tool/provider surface tests for all providers.
- Code Mode and tool-call repair regression tests.
- Typecheck, targeted ESLint, and git diff --check.

## Scope
Provider-facing tool composition and documentation/tests only; no patch engine rewrite and no removal of the payloads feature.
