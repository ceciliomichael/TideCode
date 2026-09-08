# Unified structured Code Mode payloads

## Goal
Make every provider, including OpenAI and Codex, use the same Tidecode-owned structured code_mode tool contract and add an opaque payload sidecar so arbitrary text never needs to be nested inside Code Mode source.

## Changes
- Remove the OpenAI/Codex custom freeform Code Mode transport and its provider-specific grammar branch.
- Use one structured code_mode schema for every provider: { source, payloads? }.
- payloads is an optional Record<string,string> for opaque exact text. Inject it into V2 as a read-only global named payloads.
- Bound payloads before parsing/execution: max 64 entries, 128 UTF-8 bytes per key, 2 MB total key+value bytes, blocked prototype keys rejected.
- Keep existing source-only invocations working unchanged.
- Update Code Mode prompt/tool routing so models prefer payloads for patches, Markdown, generated source, JSX, JSON, regex-heavy text, and other delimiter-heavy content.
- Do not re-embed payloads into source and do not add new literalization/source-repair rules.

## Verification
- Add regression tests for exact nested text preservation, Markdown triple-backtick payloads, read-only behavior, validation before tool execution, source-only compatibility, and provider-unified structured schema.
- Run targeted Code Mode tests, npm run typecheck, targeted ESLint for changed files/tests, and git diff --check.

## Scope
Code Mode outer transport, V2 payload injection/validation, prompt contract, and focused tests only. Do not alter unrelated tools or provider behavior outside code_mode.
