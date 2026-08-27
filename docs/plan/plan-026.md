Status: implemented

# Plan 026: Count the full Code Mode contract for every provider

## Goal
Make TideCode's context usage, prompt fingerprint, compaction budget, and cache invalidation account for the full provider-defined Code Mode contract on OpenAI/Codex, so their reported system+tool usage reflects the same semantic instructions already sent to every provider.

## Findings
- OpenAI/Codex use a provider-defined custom tool. Its semantic description and grammar live under `tool.args`, not `tool.description`.
- `describeTools()` currently reads only ordinary `tool.description`, so it undercounts OpenAI/Codex and omits their custom-tool description/grammar from `toolsHash`.
- The OpenAI Responses adapter does send `args.description` and `args.format` to the model, so this is an accounting/fingerprint bug rather than a missing model instruction.

## Changes
- Extend the canonical tool descriptor for provider-defined tools to include provider tool id and canonical provider args, including Code Mode description and grammar.
- Keep ordinary function-tool descriptors unchanged.
- Reuse that single descriptor in existing context usage, prompt manifests, compaction budgets, and cache invalidation paths.
- Add regressions proving OpenAI/Codex custom-tool description and grammar are counted and hashed, and that provider context estimates no longer omit the unified Code Mode contract.

## Reliability and cache
- Do not change cache-key derivation rules, provider cache options, model-facing Code Mode text, executor behavior, or tool transport.
- The corrected tools hash is expected to invalidate stale cache entries whose previous fingerprint omitted provider-defined tool semantics.

## Verification
- Run focused canonicalization/context-usage/Code Mode/cache tests.
- Run `npm run typecheck`.
- Run scoped `git diff --check`.

## Scope boundaries
No prompt rewrite, no provider-specific Code Mode fork, and no changes to the actual Code Mode execution or continuation behavior.
