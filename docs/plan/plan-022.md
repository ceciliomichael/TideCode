Status: implemented

# Plan 022: Provider-independent freeform Code Mode

## Goal
Make TideCode own one canonical Code Mode input: a raw JavaScript source string. Provider adapters may transport that string differently, but the executor and inner tools must receive the same source on every provider.

## Findings
- Current Code Mode is a JSON tool with { code, payloads }, which creates the missing-code failure mode.
- The CodeModeExecutor already fundamentally executes a JavaScript source string, but the worker still exposes a payloads argument.
- AI SDK OpenAI custom tools support raw string input with an optional grammar and local execute callback. Providers that cannot transport raw string custom tools need a minimal { source: string } function-tool envelope.
- apply_patch is currently documented and validated as { patch: string[] }; Code Mode should instead expose the Codex-style inner signature tools.apply_patch(input: string).

## Changes
- Introduce a provider-independent Code Mode source execution helper and remove payloads from the executor/worker contract.
- Build provider-facing code_mode as raw-string custom/freeform where the configured provider transport supports it, otherwise as a one-field { source: string } function tool.
- Normalize both provider transports to the same source string before execution.
- Change Code Mode's apply_patch inner call contract to accept a raw patch string while retaining internal native-tool compatibility where needed.
- Update Code Mode documentation and repair logic so payload-only wrappers are no longer part of the active contract.
- Preserve existing sandboxing, tool registry, patch matcher, atomic writes, result presentation, and plan/direct-mode behavior.

## Reliability and compatibility
- Reject empty source at the single normalized execution boundary.
- Do not parse assistant text as tool calls. JSON-only providers keep normal provider tool-call semantics.
- Keep legacy history readable; do not rewrite stored history.
- Avoid provider-specific execution behavior after source normalization.

## Verification
- Add focused tests for raw-string and { source } transport normalization.
- Add an executor regression proving payloads are absent and the same JavaScript program runs through the canonical path.
- Add apply_patch Code Mode tests for raw string input.
- Run focused Code Mode/tool tests, TypeScript checking, and scoped git diff --check.

## Scope boundaries
No changes to patch matching semantics, diff UI, terminal behavior, provider authentication, model selection, or unrelated tool behavior.
