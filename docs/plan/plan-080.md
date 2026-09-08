# Readable generated source contract

## Goal
Prevent AI-generated project source from being compressed into dense/minified-style formatting, and keep the shared provider instructions consistent with the direct code_mode/apply_patch/write tool surface.

## Changes
- Add a shared source-quality system-prompt component used across providers and orchestration modes.
- Require readable conventional formatting: one meaningful statement per line, normal indentation, expanded control flow, and reasonable line wrapping; forbid dense/minified one-liners unless the user explicitly requests compact/minified output or the existing file intentionally follows that style.
- Preserve concise constructs that are naturally readable; do not force gratuitous vertical expansion.
- Correct the stale Code Mode system rule so it names code_mode, apply_patch, and write as the model-facing tools in Agent Mode.
- Update prompt tests to lock both the readability contract and the three-tool routing contract.

## Verification
- Run chat-mode prompt tests.
- Run affected provider/Code Mode tool-surface tests.
- Run typecheck, targeted ESLint, and git diff --check.
