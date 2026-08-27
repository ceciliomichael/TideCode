Status: implemented

# Plan 025: Unify Code Mode instructions across providers

## Goal
Make TideCode own one Code Mode instruction/tool contract for every provider. Codex, OpenAI, Anthropic, Google, DeepSeek, Mistral, and compatible providers must receive the same TideCode system prompt and the same Code Mode semantic description. Provider differences are transport-only.

## Findings
- The shared runtime already builds one provider-independent agent system prompt.
- createCodeModeTool builds one description string, but provider transport construction is mixed into the same function.
- Codex additionally passes the shared system prompt as OpenAI providerOptions.instructions while streamText already receives system. The Responses adapter independently converts system into a system/developer prompt item, so Codex gets a provider-specific duplicate instruction path.
- OpenAI/Codex can carry Code Mode source as a native custom/freeform tool. Other providers require structured function arguments, so their unavoidable { source } wrapper remains transport-only.

## Changes
- Send the shared TideCode system string exactly once on OpenAI Responses transports. OpenAI and Codex map that same string to top-level `instructions` and set `systemMessageMode: remove` so the SDK does not also duplicate it as a system/developer input item. Keep reasoning/cache/store options unchanged.
- Extract/export one canonical Code Mode description builder/definition and use it for every provider transport.
- Keep the execution source normalization provider-neutral.
- Make the transport choice explicit and narrow: raw custom tool for OpenAI/Codex, structured source shim otherwise. Do not add provider-specific Code Mode wording.
- Add tests comparing the semantic Code Mode description across all supported provider IDs and confirming the shared agent system prompt has no provider-specific variant.
- Add provider-options regressions proving OpenAI and Codex use the same single-copy Responses prompt transport.

## Reliability, cache, and security
- Do not change prompt-cache key derivation, cache provider options, reasoning effort, auth, sandbox restrictions, tool registry, or Code Mode executor behavior.
- Removing the duplicate Codex prompt copy changes only transport. The canonical TideCode system string remains unchanged and OpenAI/Codex both carry it once as Responses `instructions`.
- Existing histories remain valid because tool/result serialization is unchanged.

## Verification
- Run provider-options, Code Mode transport/description, prompt parity, continuation/runtime tests, npm run typecheck, and scoped git diff --check.

## Scope boundaries
No attempt to force providers whose APIs require object tool arguments to accept an unsupported raw-string wire format. They still execute the same canonical JavaScript source after TideCode unwraps the transport envelope.
