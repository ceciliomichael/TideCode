# Plan 081: Code Mode contract parity and model-shaped reliability

## Goal

Make Tidecode Code Mode match the tool surface and call shapes models are actually instructed to use, with one unambiguous contract and deterministic recovery for harmless routing mistakes.

The intended Agent Mode mutation surface is:

- provider-facing `code_mode` for orchestration;
- provider-facing `apply_patch` for targeted source changes;
- provider-facing `write` for complete-file creation or intentional replacement;
- no `edit`, `apply_patch`, or `write` capability inside Code Mode.

Keep Code Mode V2 as a Tidecode-owned confined JavaScript-like interpreter. Full Access may broaden host-authorized tools but does not change the language or expose ambient Node.js/module access.

## Current findings

1. `docs/plan/plan-015.md` already established that `edit` must be hidden from Code Mode, but `factory.ts` currently puts native `edit` back into the Code Mode registry. Tests also contain many stale `tools.edit` assumptions.
2. The provider surface in normal Code Mode orchestration is already exactly `code_mode`, `apply_patch`, and `write`.
3. Code Mode currently uses `{ source, payloads? }`; the connector and the earlier V2 design use `code`. Canonicalize on `code` while accepting `source` only as a deterministic compatibility alias.
4. Direct `apply_patch` still requires `patch: string[]`. Because patch transport is now outside Code Mode, the original JavaScript quoting reason no longer applies. A raw patch string is simpler and closer to model output.
5. `src/lib/hiddenUserContext.ts` currently tells Full Access models that Code Mode may use direct Node.js APIs and module loading, while the V2 runtime and `promptContract.ts` explicitly forbid that.
6. Several old prompt files are no longer assembled into the runtime prompt. Contract changes must be made in the active prompt/tool-description builders, not in dead instruction files.
7. `toolCallRepair.ts` can already wrap misrouted `tools.<inner>` provider calls into `code_mode`, but it should also route exact direct mutation names to their actual provider tools and use the canonical `code` field.
8. Registry compatibility code for Code Mode-specific `edit` aliases is obsolete once `edit` is removed from the Code Mode registry.
9. Model-facing output and failure diagnostics should remain deterministic and concise; broader DAG, temporary tool registration, and alternate V8 execution are deferred until contract-parity failures are measured after this work.

## Implementation

### 1. Enforce one exact Code Mode capability boundary

- Exclude `edit`, `apply_patch`, and `write` from the Code Mode registry.
- Keep the native edit implementation available only to direct/native legacy surfaces and internal tests that still require it.
- Ensure `tools.$codemode.search` cannot rediscover any excluded mutation primitive.
- Keep the normal Agent provider surface at exactly `code_mode`, `apply_patch`, and `write`.

### 2. Canonicalize the outer Code Mode input

- Make `code` the canonical required field for generated/model-facing Code Mode calls.
- Keep `source` as a compatibility alias accepted only when `code` is absent.
- If both are present and differ, reject the call rather than guessing.
- Continue supporting optional opaque `payloads`.
- Update repair-generated Code Mode calls to emit `{ code }`.

### 3. Simplify direct apply_patch transport

- Change the provider-facing `apply_patch` contract to `{ patch: string }`.
- Keep the raw Codex patch grammar, full preflight, matcher, transaction/rollback, checkpoints, and presentations unchanged.
- Accept the previous array-of-lines form only as a compatibility input during migration, normalized deterministically to the same raw string.
- Update the description so models are not instructed to manually split patches into an array.

### 4. Remove Code Mode edit compatibility machinery

- Delete Code Mode-only edit descriptions, schemas, alias translation, conflict checks, and edit-specific registry validation branches.
- Remove V1 syntax-repair wording/logic that specifically targets `tools.edit`; retain generic content/payload and terminal repairs that are still used by valid inner capabilities.
- A misrouted `tools.edit` provider call must no longer be repaired into Code Mode.

### 5. Make runtime instructions agree with V2

- Update Full Access hidden execution context so Code Mode remains tool-only and cannot use direct Node.js/module APIs.
- Keep `promptContract.ts`, hidden execution context, and Code Mode description semantically identical on this point.
- Remove mutation wording that suggests patches or full-file writes belong in `payloads` or inner Code Mode.

### 6. Deterministic routing repair

- Exact `tools.<registered-inner-tool>` provider calls may still be wrapped into `code_mode`.
- Exact `tools.apply_patch` and `apply_patch` mistakes should be routed to direct `apply_patch` only when the existing input can be normalized losslessly.
- Exact `tools.write` and `write` mistakes should be routed to direct `write` only when the existing input is already valid structured input.
- Never translate `edit` into `apply_patch`; their payloads are not losslessly equivalent.
- Unknown names or malformed required arguments remain errors.

### 7. Contract-parity and model-shaped regressions

Add or update tests to prove:

- Agent Code Mode provider tools are exactly `code_mode`, `apply_patch`, and `write`.
- Code Mode registry/search excludes `edit`, `apply_patch`, and `write`.
- `code` is canonical; legacy `source` still executes; conflicting `code`/ `source` is rejected.
- direct `apply_patch` accepts raw string input and old array input during compatibility migration.
- repair emits canonical `code` and never repairs `tools.edit`.
- Full Access context does not claim ambient Node/module access.
- unknown extra generated properties remain ignorable where current compatibility policy allows them, while known fields remain strictly validated.
- malformed/unsupported Code Mode source still fails before side effects.

## Expected affected project tree

```text
docs/
  plan/
    plan-081.md

electron/
  chat/
    shared/
      codeMode/
        promptContract.ts
        toolCallRepair.ts
        validation.ts
      tools/
        applyPatchTool.ts
        factory.ts
        metaTools.ts
        registry.ts

src/
  lib/
    hiddenUserContext.ts

tests/
  codex/
    agentTools.test.ts
    applyPatchTool.test.ts
    chatModePrompts.test.ts
    codeMode.test.ts
    codeModeToolCallRepair.test.ts
    mutationReliability.test.ts
```

## File-by-file changes

- **Modify `docs/plan/plan-081.md`**: replace the speculative scalability/DAG/V8 proposal with this contract-parity reliability plan.
- **Modify `electron/chat/shared/tools/factory.ts`**: exclude `edit` from the Code Mode registry while preserving the native legacy edit tool.
- **Modify `electron/chat/shared/tools/metaTools.ts`**: canonicalize Code Mode input on `code`, support deterministic `source` compatibility, and align model-facing routing text with the real provider/inner surfaces.
- **Modify `electron/chat/shared/tools/applyPatchTool.ts`**: make raw patch text canonical and retain array-of-lines compatibility without changing patch execution semantics.
- **Modify `electron/chat/shared/tools/registry.ts`**: remove Code Mode edit-specific schema/alias compatibility machinery and leave generic generated-argument normalization intact.
- **Modify `electron/chat/shared/codeMode/toolCallRepair.ts`**: emit canonical `code`, avoid `edit` recovery, and repair exact direct-mutation routing only when lossless.
- **Modify `electron/chat/shared/codeMode/validation.ts`**: remove obsolete `tools.edit` mutation-string repair coupling while retaining still-valid generic repairs.
- **Modify `electron/chat/shared/codeMode/promptContract.ts`**: keep the concise V2 language contract aligned with the actual provider mutation boundary and Full Access semantics.
- **Modify `src/lib/hiddenUserContext.ts`**: remove the stale Full Access claim about direct Node/module access.
- **Modify focused tests under `tests/codex/`**: replace stale `tools.edit` Code Mode assumptions with direct `apply_patch` or native-edit coverage as appropriate and add parity regressions.

## Verification

1. Run focused Code Mode/provider-surface/repair/apply-patch/mutation/prompt tests.
2. Run `npm run typecheck`.
3. Run changed-file ESLint where the project script supports it.
4. Run `git diff --check`.
5. Inspect the scoped diff to verify pre-existing unrelated working-tree changes were not overwritten.

## Scope

No patch matcher/parser rewrite, no native edit backend deletion, no DAG execution, no temporary tool registration, no alternate V8 execution engine, no unrelated UI/browser/terminal cleanup, and no broad compatibility guessing.

## Status

Implemented and verified.

- Production Agent Mode exposes exactly `code_mode`, `apply_patch`, and `write`.
- Production Code Mode excludes `edit`, `apply_patch`, and `write` from its inner registry and discovery surface.
- `code` is the canonical Code Mode input while legacy `source` is accepted only as a deterministic compatibility alias.
- Direct `apply_patch` uses raw patch text canonically while retaining array-of-lines compatibility.
- Full Access keeps the same confined Code Mode language and broadens only host-authorized tools.
- Misrouted known inner calls are repaired into Code Mode; direct write/apply_patch mistakes are routed losslessly; edit is never translated.
- Focused regressions, TypeScript typecheck, changed-file ESLint, scoped diff checks, and the full `npm run test:tools` suite pass.
