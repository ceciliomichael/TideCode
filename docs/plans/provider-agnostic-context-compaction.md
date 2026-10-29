# Provider-agnostic context accounting and compaction redesign

Status: implemented in the working tree after user approval. Automated verification and remaining limitations are recorded in section 20. Numerical policy defaults remain estimates, and no live-provider cache-savings claim is made.

Prepared: 2026-10-27.

## 1. Outcome and scope

TideCode must be able to keep a conversation going through long tool-using turns, images, model changes, and repeated compactions without losing supported progress or treating an optional maintenance failure as a fatal run error. The context indicator and compaction decisions must use the same accounting for the actual next request. Prompt prefixes should remain stable between compactions, and cache benefits must be measured from provider reports rather than inferred from a cache key.

The implementation is shared across every provider TideCode can currently call, including custom OpenAI-compatible endpoints. Provider-specific behavior is limited to verified request constraints, image estimation rules when available, usage normalization, and supported cache options. A provider with no cache reporting or token-count endpoint must still work. Provider-neutral behavior does not promise an exact token count, supported vision, or cache savings for an arbitrary endpoint.

This plan replaces the previous exploratory proposals in this conversation. It keeps the existing two-worker durable-memory and continuation design, current canonical-history storage, provider transports, and user-first retention rules. It reworks request accounting, scheduling, validation, commit sequencing, and diagnostics around them.

### Included

- One accounting path for live and preview context, including temporary images.
- Distinct configured context capacity, input limits, output reserve, and estimation allowance.
- A preferred compaction threshold and a separate admission limit for the next request.
- Explicit compaction outcomes, bounded repeat attempts, safe mid-turn compaction, and manual compaction using the same core.
- Durable commit before switching the live replay to a new snapshot.
- Stable prompt ordering and honest cache/worker usage reporting.
- Existing desktop, shared run service, CLI, and mobile/shared consumers remain on one current contract.
- Regression and benchmark coverage, including an isolated investigation of the reported conversation.

### Excluded

- Replacing provider SDKs, adding provider-native opaque compaction, or a provider-specific compaction engine.
- Remote token-count requests on every model step, a tokenizer dependency for every model, or guessing capabilities from model-name substrings.
- Background speculative summary generation, recursive summarization trees, a plugin registry, or a new database.
- New explicit provider cache-resource lifecycle management, paid TTL extensions, or a cache-cost optimizer.
- Rewriting saved user conversations, deleting history, changing tool permissions, or broad cleanup.
- Automatically replaying tool actions or switching the configured summarization provider after a failure.

## 2. Evidence and current implementation

The reported chat is `30655c62-f541-4078-878f-865cab74b962`. Its visible history and canonical history are stored in the user's TideCode history directory, outside this repository. Use their IDs to locate isolated copies during diagnosis; do not check the files or conversation contents into source control.

Confirmed from the inspected records:

- The final failed run is `cb9ed309-3eea-4306-9af4-1d3d033a5e66`.
- Its final recorded model step is numbered 30 and reports 98,833 input tokens.
- The final tool call has a recorded result. This does not prove that every earlier tool pair in the reconstructed request is valid.
- The generic compaction error is recorded about 214 ms after that step record. Timing suggests an early failure but does not prove which branch failed.
- A prior compaction exists elsewhere in the conversation history; no successful compaction is recorded for this failing run.
- Settings read during diagnosis were 256,000 context tokens, an 80% trigger, and 10,000 retained-context tokens. These are not a saved snapshot of the incident's settings.
- No durable image parts appeared in the inspected response messages for this run. Temporary image messages are deliberately omitted from canonical replay, so this is not proof that the provider saw no images.

Confirmed current code:

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `src/lib/contextUsage.ts` | Text is approximated from serialized content at roughly four characters per token; recognized image payloads are replaced and charged a fixed 1,024-token allowance. | Base64 size does not explode the count, but this is not exact model-specific tokenization. |
| `shared/runtime.ts` | Temporary visual messages are stripped before the live budget and indicator event, but can be included in the request and reattached after compaction. | Live visual inputs can be omitted from both preflight and post-compaction budgeting. |
| `compaction/budget.ts` | The configured percentage itself makes compaction required. Output reserve influences retention but not that threshold comparison. | An unavailable optional reduction can terminate a request that still has usable space. |
| `compaction/gate.ts` | Missing projection and projection at or above the full window share one generic error. | The saved error does not identify the failed condition. |
| `compaction/service.ts` | Budget/window work is repeated in the outer and inner functions; `null` represents several different outcomes. | Scheduling, selection, and failure handling are difficult to distinguish. |
| `compaction/window.ts` | Checks all call/result IDs and supports reducing an oversized current turn after complete tool results. | The reported failure must not be attributed to an absent feature that already exists. |
| `compaction/projection.ts` | Protects latest user intent, adds the handoff/runtime instructions, and retains bounded conversation content. | Preserve these intent protections while unifying the budget passed to them. |
| `shared/runtime.ts` | `safelyPersistHistory` logs and swallows save failures, including automatic compaction commits. | Live projection and success presentation must not get ahead of a failed durable compaction save. |
| `cache/providerPolicies.ts` | Stable keys, provider options, and an Anthropic tool breakpoint already exist. | Improve and verify the current integration instead of adding a second cache layer. |
| `cache/usage.ts`, `cache/diagnostics.ts` | Missing cache counts become numeric zero; positive input with no positive cache count may be classified as a miss. | Unreported cache usage can look like a confirmed miss. |
| `models/catalog` | `maxTokens` is documented as maximum output tokens. | Never interpret it as context capacity or maximum input tokens. |

The image omission is a confirmed accounting gap, not a confirmed explanation of the original compaction error. The implementation report must preserve that distinction.

## 3. Non-negotiable behavior

1. One model step has one immutable prepared request for accounting and dispatch. SDK or adapter transformations must be represented by verified overhead rules or labeled uncertainty; the host cannot claim an exact wire count it does not possess.
2. Images included in a request count toward that request even when excluded from persistent replay and the text-only compaction transcript.
3. Cached input still occupies context. Never subtract cached tokens from context occupancy.
4. The latest actual user request and attachments remain intact. Same-turn steering and outstanding obligations remain represented. Historical requests do not become new instructions or new approval.
5. No unmatched tool call/result is sent because compaction dropped its counterpart. Never fabricate a successful tool result to repair history.
6. A compaction summary is historical evidence, not an instruction source with greater authority than the user or system.
7. A successful compaction is durable before it becomes the active replay or a committed UI marker.
8. Branch changes, model changes, cancellation, and late worker responses cannot commit into the wrong context.
9. No provider request is admitted when the shared budget says it does not fit. A heuristic estimate is not a proof that a provider will accept it; provider rejections remain possible and actionable.
10. Continue automatically after a failed preferred compaction only when the original request remains valid and fits the admission budget. Never continue after cancellation or stale ownership.
11. Existing persisted chats and their valid snapshots remain readable. Retaining the current storage format avoids a destructive migration; do not add old/new compaction engines or compatibility switches.
12. All diagnostics distinguish observed facts, estimates, and unavailable information.

## 4. Architecture and ownership

Keep current focused modules and add only three production responsibilities:

- `electron/chat/shared/contextRequest.ts`: construct a request snapshot and its accounting views; no model calls or storage writes.
- `electron/chat/shared/contextCapabilities.ts`: resolve the actual provider/model constraints and estimation mode from verified inputs; no scheduling or cache lifecycle.
- `electron/chat/shared/compaction/coordinator.ts`: orchestrate one compaction attempt and its safe commit; no provider-specific counting or low-level retention algorithms.

`budget.ts` owns pure arithmetic and the scheduling decision. `window.ts` owns safe source selection. `service.ts` owns the two model workers. `projection.ts` owns rebuilt durable context. `gate.ts` owns request admission and typed failure classification. Existing history code owns atomic storage and branch validation. Existing provider clients own SDK translation and supported cache options.

```text
prepared request + model constraints
               |
               v
    shared accounting and budget
               |
     +---------+----------+
     |                    |
  continue           compact/defer/block
     |                    |
 provider           select safe source
 request                  |
     |               memory + handoff
 usage                    |
 report           rebuild request with visuals
                          |
                    validate budget
                          |
                 commit canonical snapshot
                          |
                 publish new replay and usage
```

No speculative background compaction: all attempts occur at an existing serialized continuation boundary. This eliminates avoidable races and wasted worker requests while retaining mid-turn support.

## 5. Request snapshot and accounting contract

### 5.1 Snapshot

Create a `PreparedContextRequest` in `contextRequest.ts` with immutable references or immutable copies for:

- Provider identity, endpoint/configuration identity, model ID, reasoning setting, and run/branch identity.
- Stable system prompt, deterministically ordered tools, and model messages actually destined for the next step.
- Durable message view used for history/compaction, and temporary visual view used only for the current request lifecycle.
- Configured limits, effective output reservation, counting policy version, and request fingerprint.
- Logical model-step number; do not confuse a restarted SDK stream's local step zero with a new user turn.

Separate `requestMessages` from `durableMessages` by explicit names, not by mutating the same array. The request includes each offered visual once. A visual offer is not considered consumed merely because a local budget check ran; preserve the existing dispatch/consumption lifecycle and verify it under compaction and cancellation.

Build the snapshot after steering, workspace context, image support filtering, visual externalization, and provider-valid replay preparation. After compaction, rebuild the full snapshot through the same function before admission. Do not validate only the durable projection and append uncounted images later.

### 5.2 Displayed categories

The estimate exposes disjoint token categories: system, tool schemas, hidden/runtime injections, conversation text/replayed visible reasoning, tool-result text, and images. Sum these once into `estimatedInputTokens`. Image metadata overhead belongs to its source text category; image payload allowance belongs only to images. A message must not be counted once as a tool result and again through its stored UI invocation result.

Expose output reserve, uncertainty allowance, effective input ceiling, preferred trigger, counting method, and scope (`next_request` or `reconstructed_preview`) separately. They must not be silently added to the displayed input-token total.

The displayed percentage remains estimated input divided by effective context capacity. The tooltip explains that compaction can occur earlier to reserve response space. The preferred percentage setting retains its literal full-window meaning; the safety limit is a separate concept.

### 5.3 Estimation policy for this implementation

Use the existing pure estimator as the generic baseline, with the following concrete improvements:

- Count only model-visible content and deliberately represented transport overhead. Exclude stored UI fields and opaque binary payload sizes; do not blindly serialize provider metadata as text.
- Preserve the current text approximation as an explicitly heuristic method. No new tokenizer dependency or remote counting request is required for this release.
- Every supported image/file image part is recognized, including temporary tool images. Generic unknown-model image allowance becomes 4,096 tokens per image, labeled heuristic. This is an engineering estimate, not a universal upper bound.
- Carry already-available dimensions/detail metadata through accounting. Do not fetch remote image URLs merely to estimate them or decode large images on every render.
- Do not invent model-specific formulas. This release uses the generic policy unless a verified estimator already exists in the relevant transport; provider-specific formula additions require documented exact model applicability and tests, not name substring matching.
- Text with non-ASCII content is still marked heuristic. The safety allowance and observed discrepancy feedback below address uncertainty; do not claim exact multilingual tokenization.

Generic counting is intentionally honest rather than falsely precise. If images or a custom endpoint cause a provider rejection, surface the provider context error and the estimate that admitted it. Do not automatically resend tools, discard images, or silently increase configured context capacity.

### 5.4 Provider usage feedback

Record the local preflight estimate with its request fingerprint, then associate provider usage with that exact completed step. The UI may display the last reported total alongside the current estimate; never replace next-request usage with the previous request's total.

Within a single append-only run segment, maintain a positive undercount correction:

`correction = max(previousCorrection, reportedInputTokens - localEstimateForThatRequest, 0)`.

Apply it as an overhead allowance to later requests only while provider, endpoint, model, system/tools fingerprint, and exact prior-message prefix remain unchanged. Reset after compaction, replay rewrite, image removal/replacement, or model/configuration change. Never learn a downward correction from one response, and never apply conversation-wide aggregate usage to a single request. Missing or inconsistent usage supplies no correction. This bounded scalar state is run-local, not a persistent calibration database.

## 6. Model constraints and arithmetic

### 6.1 Resolve limits without guessing

- Keep the existing user-configured `contextWindowTokens` as the authoritative configured cap. The setting remains available for custom endpoints.
- Use a verified provider input/context constraint only when it is actually available from the existing transport/configuration. Effective capacity is the smaller of the configured cap and a known applicable provider cap. Unknown is represented explicitly, not populated from output limits.
- `maxTokens` remains maximum output. Do not add a context-capacity catalog across all models as part of this work.
- Resolve the output reservation once and pass that same output limit through the provider request where the provider supports an explicit limit. Do not reserve 20k while actually requesting a known 128k output maximum.
- For normal steps use the existing policy ceiling: `O = min(20_000, floor(C * 0.25), knownMaximumOutput if present)`. This deliberately establishes a bounded per-step response budget; reasoning and visible output must follow the selected transport's documented output semantics. Check SDK/provider support before setting it.
- If a provider cannot express the reservation as an enforced output parameter, label it a reservation rather than a guaranteed cap. Do not send an unsupported field.
- A configured summarization model has its own constraints and output allowance. Never reuse the source chat model's capacity as the worker's capacity.

### 6.2 Deterministic policy

Use integer tokens and reject non-finite/negative limits. Let:

- `C` = effective configured/known total context capacity.
- `E` = estimated input tokens, including temporary images.
- `K` = applicable positive undercount correction from section 5.4.
- `O` = reserved output tokens.
- `U` = uncertainty reserve: `max(1_024, ceil(C * 0.05))` for the generic heuristic. An existing verified count may use `max(256, ceil(C * 0.01))`; do not classify an SDK estimate as exact without evidence.
- `A` = admission ceiling: `min(C - O - U, knownInputLimit if present)`.
- `P` = preferred trigger: `floor(C * triggerPercent / 100)`.
- `D` = minimum preferred-compaction saving: `max(1_024, ceil(C * 0.02))`.

If `A <= 0`, report an invalid/insufficient configured budget. Do not clamp it upward into a fictitious valid budget. The request fits when `E + K <= A`; otherwise compaction is required. The preferred threshold is crossed when `E + K >= P` even if `P` is above `A`; safety always takes precedence.

These constants are deliberate initial implementation defaults, not empirically optimal claims. Keep them named in `budget.ts`, test boundary arithmetic, and report benchmark sensitivity before changing them. No new settings sliders are needed.

### 6.3 Worked examples

For a configured 256k window, no lower known provider cap, generic counting, and the 80% preferred setting:

- Output reserve is 20k; uncertainty reserve is 12.8k.
- Admission ceiling is 223.2k input tokens.
- Preferred trigger is 204.8k.
- At 205k, try useful compaction at the current safe boundary. If that attempt is unavailable or fails and the unchanged request still fits, continue with a recorded deferral.
- At 224k, compact successfully before the next model request or stop with a specific reason.

For a 16k window, output reserve is 4k and uncertainty reserve is 1,024, giving a 10,976-token ceiling. An 80% preferred setting cannot override that earlier safety limit. The UI must explain this rather than displaying a mysterious premature trigger.

## 7. Scheduling, attempt limits, and outcomes

Replace `CompactionResult | null` for current internal calls with a discriminated outcome. Suggested variants: `not_needed`, `deferred`, `compacted`, `blocked`, `failed`, and `aborted`. Each has a finite reason code and only the data valid for that state. The worker service itself receives an already selected window; it does not repeat trigger checks.

The coordinator evaluates this table before each actual request:

| State | Action |
| --- | --- |
| Valid request below preferred and within admission | Continue without calling a worker. |
| Preferred crossed, useful safe window available | Attempt compaction synchronously at this boundary. |
| Preferred crossed, no useful safe reduction, original still fits | Record deferral; continue unchanged. |
| Preferred worker timeout/error/invalid result, original still fits | Preserve original; report one nonfatal attempt failure and continue subject to attempt limits. |
| Above admission, useful window available | Compaction is mandatory; validate and commit before continuing. |
| Above admission, no valid window or failed worker/projection | Stop with the precise cause; no provider request. |
| Malformed tool pairs at request boundary | Stop for invalid context even if token budget fits. Do not send malformed history. |
| Parent cancellation or ownership changed | Abort/discard candidate; never continue from that attempt. |
| Manual request | Attempt once regardless of preferred threshold; return precise no-op/failure when no useful compaction exists. |

Bound attempts without a timer loop:

- At most one preferred model-worker attempt per active run between successful compactions. A successful commit resets eligibility because it establishes a new source segment.
- A later admission-limit crossing permits one required attempt even after a preferred failure. Do not retry the identical input/configuration immediately after a deterministic invalid projection.
- Manual invocation permits a fresh explicit attempt.
- Reopening or a new user run can attempt preferred compaction again. No background polling or endless retry.
- Deferred selection checks do not incur model calls and are recomputed only when input/settings identity changes.

Do not automatically compact at final completion merely because the preferred threshold was crossed. There is no next request to admit. Save the completed turn; evaluate at the next send. Remove the duplicated final automatic worker flow from `runtime.ts`. Manual compaction remains available for users who want it before the next turn.

## 8. Retention and worker behavior

### 8.1 Protected context and target

Preserve the existing 10k default retained durable-context target and existing configured retention value as a preferred target. Do not silently replace the established intent-retention policy with a large fixed percentage of a million-token window.

The target is not a hard ceiling on a valid latest user request. Compute the budget remaining after system/tools, temporary images, output and uncertainty reserves. Protect the latest real request/attachments, active steering, current runtime instructions, and a useful handoff allowance first. If they exceed the preferred retention target but fit below admission, expand the target just enough to preserve them. If they cannot fit below admission, report `protected_context_too_large`; never truncate the user's latest request to force success.

For a preferred attempt, require a post-compaction reduction of at least `D` and a result below the preferred trigger by at least `D`. If those are unattainable while the original request fits, defer rather than repeatedly rewriting its prefix. For a required attempt, admission fit and positive reduction are mandatory; the preferred saving floor is waived to allow a feasible recovery. Record that recovery had limited headroom.

Use the same counting policy and target through selection, handoff output budgeting, projection, and final request validation. Reuse `conversationRetention.ts` for user-first ordering and the existing receipt/evidence modules for supported outcomes. Avoid separate arithmetic hidden inside multiple functions.

### 8.2 Safe source range

Keep the current ability to summarize an oversized active turn after completed tool results. Resolve the prior compaction barrier on the active branch, then select new source evidence and retained tail. Return a structured reason for no source, unreducible protected context, unmatched tools, or insufficient useful reduction.

Do not fix orphan calls by globally deleting them or fabricating outputs. If replay reconstruction demonstrably created a mismatch from valid saved data, correct the reconstruction under a separately explicit implementation amendment. Otherwise report invalid context with diagnostic IDs/counts. The original incident investigation is required, but it does not authorize arbitrary replay rewrites.

### 8.3 Two worker calls remain

Keep memory initialization/reconciliation and continuation generation separate. Keep the user-approved separate initialization and reconciliation Markdown prompts. Both workers receive the evidence necessary to understand the newest retained/shortened results, the latest actual request, previous memory/handoff, and active-versus-settled lifecycle.

Before each worker request, budget that worker's actual serialized prompt with its own selected model constraints and output reservation. Continue existing bounded tool-evidence serialization; do not silently drop user intent or newest failure evidence to fit a smaller summarizer.

When a configured summarizer cannot fit the necessary source, report `summarizer_context_too_large` with usable action: select a sufficiently capable summarization model or shorten the input. Do not silently switch providers, recursively chunk the transcript, or claim that more history was summarized than the worker received. Automatic hierarchical summarization is outside this bounded redesign.

Keep existing cancellation and timeout mechanisms, but surface timeout separately from parent cancellation. Collect worker input/output/cache usage when returned and attach it to the attempt. If absent, mark unreported. Do not count worker requests as primary-chat model steps.

## 9. Commit, concurrency, and durability

The coordinator performs these steps in order:

1. Drain outstanding history writes relevant to the current source; fail rather than build a durable boundary on unsaved required evidence.
2. Capture branch ID, parent packet ID, relevant source digest, model/configuration fingerprint, and current source anchor.
3. Select one window and generate candidate memory/handoff without mutating live replay or saved history.
4. Build candidate durable projection, refresh required runtime context, reattach the current temporary visuals once, and calculate the complete next-request budget.
5. Validate protected user content, source/branch identity, message integrity, output allowance, and request admission.
6. Check cancellation/ownership again, then atomically record the memory, packet, projected durable messages, accounting diagnostics, and attempt outcome using the existing history update lock.
7. Only after successful persistence, swap live replay/packet/memory and publish `compaction_committed` and updated usage.

Add expected branch/parent/source guards to the existing commit operation. Avoid rejecting harmless observation-only history changes by comparing the relevant source identity, not blindly requiring an unchanged global revision. Use the existing locked document update to perform the final compare and write together.

Remove the swallowing persistence wrapper only for operations required to establish this compaction transaction. Do not refactor all unrelated history behavior. A failed save leaves original live context and history intact. If the original request fits, a preferred attempt may continue with the failure recorded; a required attempt cannot.

Cancellation before the commit point prevents adoption. Cancellation after a successful atomic write may leave a valid committed snapshot, but no further model request is sent. Reopen must recover that committed snapshot. An event-delivery failure after durable commit must not roll back the saved snapshot or cause duplicate commits.

Steering that arrives during worker calls remains queued for the next preparation. It is not absorbed into a candidate generated before the message existed. A branch/revert or model ownership change invalidates the candidate. Manual and automatic attempts for the same source share existing in-flight deduplication, but cancellation ownership must not let one consumer cancel another live owner's work; serialize through the existing conversation/run ownership model rather than adding a global scheduler.

## 10. Cache-efficient behavior

### 10.1 Stable input

Retain the existing stable system prompt, deterministic tool order, and late runtime instructions. Keep the generated handoff and durable-memory reminder byte-stable until the next committed compaction. Append ordinary new context rather than regenerating old summary text every step.

Do not change cache keys on every model step, percentage change, diagnostic event, or temporary image. Existing provider/model/context scope remains the key basis. Provider/configuration changes invalidate appropriate scope. A compaction inherently changes the history prefix; keeping a key stable cannot preserve a mismatched prefix cache and must not be reported as doing so.

Temporary visuals can also change a prompt prefix when removed. Correct request lifecycle and current relevance take precedence over retaining stale screenshots just for caching. Record the corresponding prefix change in benchmark diagnostics.

### 10.2 Provider policies

Use existing provider option translation and deterministic Anthropic tool breakpoints. Verify supported options against the installed SDK and primary provider docs. Do not attach OpenAI options to every custom compatible endpoint, assume Codex inherits all public OpenAI API features, or create Google cache resources without an explicit supported lifecycle.

All providers use the same compaction schedule and validation. Cache capability is not required for continuing or compacting. This implementation improves cache reuse by avoiding unnecessary prefix rewrites and retry loops, not by promising provider cache retention.

### 10.3 Usage semantics

Extend normalized usage with presence metadata rather than changing every numeric historical aggregate into nullable data. New records identify whether input/cache-read/cache-write/no-cache values were reported, derived, or unknown. Existing records without presence metadata are treated as unknown for claims that require it; no historical rewrite is necessary.

Prefer the installed SDK's documented normalized totals when valid. Apply raw provider-specific mappings only where tested. In particular, verify whether input totals already include cache read/write portions before summing them. Never double-count SDK totals by adding raw cache fields again.

Classify `miss` only when cache reporting is supported/reported and explicitly indicates zero reads. Otherwise use `unreported`. Validate nonnegative finite values, and mark inconsistent totals unusable for ratios/calibration rather than quietly manufacturing a plausible value.

Compute cache-read fraction as reported cache-read input divided by reported total input for a comparable cohort. Exclude unknown observations from that denominator and state coverage. Separate chat and compaction workers. Cache-write tokens are not cache hits; their cost depends on provider pricing. Do not claim dollar savings without the applicable verified prices.

## 11. User-facing behavior and diagnostics

### 11.1 Context indicator

Keep the existing compact indicator and manual Compress Chat control. Extend its tooltip, not the main chat UI, with:

- Estimated input / effective configured capacity, including a separate Images row.
- Output reserve and uncertainty headroom.
- Preferred compaction point and a short explanation when safety requires earlier compaction.
- Current request versus reconstructed preview label.
- Last provider-reported input only when associated with this conversation/model and clearly labeled as the last request.

Live run usage has precedence over a delayed preview response. Reopening shows reconstructed durable context; it cannot claim to include temporary images from an old request. Keep accessibility labels and mobile tooltip behavior.

### 11.2 Settings

Retain the existing context-window and preferred percentage controls. Explain that unknown providers use the configured capacity, output capacity is separate, and room is reserved for the response. Rename trigger copy to preferred automatic compaction without adding another slider. Keep stored setting names to avoid unnecessary migration.

### 11.3 Failures

Centralize user-facing copy in the existing error catalog. Internal reason codes include:

`invalid_context_budget`, `invalid_tool_pairs`, `no_compactable_source`, `insufficient_reduction`, `protected_context_too_large`, `summarizer_context_too_large`, `worker_timeout`, `worker_error`, `invalid_handoff`, `projection_too_large`, `stale_source`, `commit_failed`, and `aborted`.

Provide action based on known cause. Example: "This request and its attachments leave too little room for a response. Shorten the request or choose a model with a larger supported context." Do not tell the user to retry a network connection when the actual problem is protected-context size.

A deferred preferred compaction must not set the run to failed or display a committed divider. A started attempt always reaches a terminal lifecycle event so the spinner cannot remain active. Keep tool groups finalized at their original positions. A commit event carries its attempt identity and boundary anchor consistently through desktop and shared run-service surfaces.

### 11.4 Stored diagnostics

Store bounded attempt records in canonical history using the existing event mechanism: reason, mode (preferred/required/manual), logical step, source digest, branch/parent identity, before/after category totals, capacity/reserves, counting method, worker model, durations, worker usage availability, and outcome. Store only IDs, hashes, counts, finite reason codes, and sanitized errors. Do not duplicate transcripts, raw provider payloads, image bytes, credentials, or full prompts into diagnostic records.

Persist ordinary request accounting with its step record rather than adding a new full diagnostic event on every below-threshold decision. At an attempt that fails before another model step, persist the attempt outcome so this incident can be diagnosed later. A save failure may only be available in run diagnostics; do not falsely claim the diagnostic was saved to a failing filesystem.

## 12. Planned project structure

`[new]` denotes a file to create; all other listed files already exist and are expected to be modified. Existing untouched support modules are omitted from this affected-area tree.

```text
docs/plans/provider-agnostic-context-compaction.md
ARCHITECTURE.md
DESIGN.md
AGENTS_LEARNING.md
electron/
  chat/
    cache/{usage.ts,diagnostics.ts,providerPolicies.ts}
    history/{contracts.ts,validation.ts,eventStore.ts}
    shared/
      contextCapabilities.ts                         [new]
      contextRequest.ts                              [new]
      runtime.ts
      runtimeContextUsage.ts
      compaction/
        coordinator.ts                               [new]
        automatic.ts
        budget.ts
        contracts.ts
        gate.ts
        window.ts
        service.ts
        projection.ts
        conversationRetention.ts
        manual.ts
        modelSelection.ts
        durableMemory.ts
    apiKey/{client.ts,runtime.ts}
    codex/{client.ts,runtime.ts}
  cli/replCommands.ts
  runService/{protocol.ts,server.ts}
src/
  types/chat/runtime.ts
  lib/
    contextUsage.ts
    contextCompactionSettings.ts
    userFacingError.ts
    chatCompactionStatus.ts
    errors/errorCatalog.ts
  hooks/useChatContextUsage.ts
  pages/chatInterface/useChatCompression.ts
  components/
    chat/ContextIndicator.tsx
    settings/context/ContextSettingsPanel.tsx
scripts/diagnoseContextCompaction.ts                  [new]
tests/
  fixtures/contextCompactionScenarios.ts              [new]
  codex/
    contextCapabilities.test.ts                       [new]
    contextRequest.test.ts                            [new]
    compactionCoordinator.test.ts                     [new]
    cacheAccounting.test.ts                           [new]
    contextUsage.test.ts
    automaticCompaction.test.ts
    compactionGate.test.ts
    compactionRetention.test.ts
    compactionV2.test.ts
    localCompaction.test.ts
    canonicalHistory.test.ts
    compactionAbortCleanup.test.ts
    userFacingError.test.ts
  components/contextIndicatorAppearance.test.tsx
  openaiCompatible/deepSeekCachePrefix.test.ts
  chatCompactionStatus.test.ts
  toolVisualResultMessages.test.ts
  contextUsageRefresh.test.ts
```

## 13. File-by-file implementation changes

### Production context and compaction

| Action | File | Responsibility/change |
| --- | --- | --- |
| Create | `electron/chat/shared/contextCapabilities.ts` | Resolve configured versus verified limits, output reservation applicability, counting method, and provider identity without treating output maxima as context. |
| Create | `electron/chat/shared/contextRequest.ts` | Immutable request/durable/visual views, shared accounting, request identity, and run-local positive undercount correction. |
| Modify | `src/lib/contextUsage.ts` | Disjoint image accounting, generic 4,096-image allowance, metadata-safe estimation, and method labels. Keep renderer-safe pure logic. |
| Modify | `electron/chat/shared/compaction/budget.ts` | Shared arithmetic, preferred/admission decisions, protected-fit target, reserves and named constants. Remove conflicting trigger/retention calculations. |
| Modify | `electron/chat/shared/compaction/contracts.ts` | Typed attempt outcomes, prepared-window worker inputs, worker usage/result contracts, and structured diagnostics. Preserve existing packet storage shape. |
| Modify | `electron/chat/shared/compaction/automatic.ts` | Keep logical-step/boundary identification; route scheduling through the shared budget rather than another independent trigger. |
| Modify | `electron/chat/shared/compaction/window.ts` | Return selection result plus exact no-window cause; keep safe pairs and active-turn selection. |
| Modify | `electron/chat/shared/compaction/gate.ts` | Enforce admission and integrity with typed causes; preferred failure alone is not fatal. |
| Create | `electron/chat/shared/compaction/coordinator.ts` | One attempt lifecycle, eligibility, worker orchestration, full-request revalidation, guarded commit and publication result. |
| Modify | `electron/chat/shared/compaction/service.ts` | Accept selected source and explicit budgets once; remove duplicated scheduling/window checks; collect worker outcome/usage. |
| Modify | `electron/chat/shared/compaction/modelSelection.ts` | Resolve summarizer constraints separately; give memory and handoff stable distinct worker cache suffixes and usage observation. |
| Modify | `electron/chat/shared/compaction/durableMemory.ts` | Budget memory worker input/output and return usage/timeout diagnostics without changing memory semantics or prompt selection. |
| Modify | `electron/chat/shared/compaction/projection.ts` | Use passed effective target and common estimator; no hidden re-clamp that defeats protected-context expansion. |
| Modify | `electron/chat/shared/compaction/conversationRetention.ts` | Preserve latest request/attachments and bounded earlier intent using the passed target; never truncate protected user content. |
| Modify | `electron/chat/shared/compaction/manual.ts` | Reuse coordinator validation/commit path in explicit mode and return a precise no-op/failure result. |
| Modify | `electron/chat/shared/runtime.ts` | Build snapshots, invoke coordinator, integrate output reservation and usage, preserve visuals/steering, remove duplicate final auto-compaction flow. Do not add more orchestration to the monolithic file. |
| Modify | `electron/chat/shared/runtimeContextUsage.ts` | Reuse snapshot accounting for idle preview; same limits/categories, explicit reconstructed scope. |
| Modify | `electron/chat/apiKey/client.ts` | Pass the agreed output bound and observation metadata through the existing SDK contract; preserve provider validation. |
| Modify | `electron/chat/codex/client.ts` | Same bound/usage contract for Codex without assuming unsupported public API features. |
| Modify | `electron/chat/apiKey/runtime.ts` | Translate the current typed manual outcome and worker usage contract instead of interpreting non-null as success. |
| Modify | `electron/chat/codex/runtime.ts` | Same manual outcome translation for Codex; remove its duplicate success/null assumption. |

### Cache, storage, transport, and UI

| Action | File | Responsibility/change |
| --- | --- | --- |
| Modify | `electron/chat/cache/usage.ts` | Preserve reported/derived/unknown presence and normalize provider totals without double counting. |
| Modify | `electron/chat/cache/diagnostics.ts` | Unknown cache reports stay unreported; measured-cohort ratios and worker/chat separation. |
| Modify | `electron/chat/cache/providerPolicies.ts` | Keep supported deterministic cache behavior; make capability assumptions explicit and avoid unknown custom-provider options. |
| Modify | `electron/chat/history/contracts.ts` | Optional accounting/presence metadata and bounded compaction-attempt event in the current history envelope. |
| Modify | `electron/chat/history/validation.ts` | Validate new metadata/events; old records remain valid with unavailable diagnostics, not invented values. |
| Modify | `electron/chat/history/eventStore.ts` | Atomic guarded compaction commit, attempt records and per-step accounting; record actual run identity instead of losing attempt attribution. |
| Modify | `src/types/chat/runtime.ts` | Context categories/scope/reserves, manual outcomes and attempt failure reason contracts shared by surfaces. |
| Modify | `electron/runService/protocol.ts` | Bump protocol version from 16 to the next available version when implementing changed runtime contracts. |
| Modify | `electron/runService/server.ts` | Forward typed outcomes consistently and preserve shared ownership/last live usage. |
| Modify | `src/lib/contextCompactionSettings.ts` | Document preferred trigger and soft retained target; keep current persisted keys and clamp configuration only, not feasible runtime budgets. |
| Modify | `src/hooks/useChatContextUsage.ts` | New category defaults, live-over-preview ownership, stale-request prevention, and model/request provenance. |
| Modify | `src/lib/chatCompactionStatus.ts` | Match terminal outcomes by attempt identity; reject stale success/failure updates without leaving a spinner active. |
| Modify | `src/pages/chatInterface/useChatCompression.ts` | Present precise manual no-op/blocked outcomes and only mark success after a committed result. |
| Modify | `electron/cli/replCommands.ts` | Use current stored compaction settings instead of hardcoded defaults for manual requests and display precise returned outcomes. |
| Modify | `src/components/chat/ContextIndicator.tsx` | Images, estimate provenance, reserves and preferred point in existing tooltip/accessibility labels. |
| Modify | `src/components/settings/context/ContextSettingsPanel.tsx` | Explain configured capacity and preferred trigger versus response-space safety. |
| Modify | `src/lib/errors/errorCatalog.ts` | Central plain-language compaction errors and specific recovery actions. |
| Modify | `src/lib/userFacingError.ts` | Map typed compaction causes to the catalog without burying known cause under generic copy. |

### Diagnostics, verification, and project knowledge

| Action | File | Responsibility/change |
| --- | --- | --- |
| Create | `scripts/diagnoseContextCompaction.ts` | Read-only copied-history reconstruction and deterministic scenario comparison; explicit input/output arguments, sanitized JSON report, no implicit real-history writes or provider calls. |
| Create | `tests/fixtures/contextCompactionScenarios.ts` | Synthetic long-turn, image, threshold, protected-request, cancellation and cache-reporting scenarios without personal transcript content. |
| Create | `tests/codex/contextCapabilities.test.ts` | Output/context distinction, unknown endpoints, changed models, and effective reservation. |
| Create | `tests/codex/contextRequest.test.ts` | Actual outgoing images counted once, preview scope, correction identity and reset. |
| Create | `tests/codex/compactionCoordinator.test.ts` | Required/preferred outcomes, attempt limits, atomic commit ordering, stale/cancelled candidates and disk failures. |
| Create | `tests/codex/cacheAccounting.test.ts` | Unknown versus zero, normalized/provider raw totals, cache key stability and worker attribution. |
| Modify | `tests/codex/contextUsage.test.ts` | Categories, image/Unicode heuristics, common live budget and reserves. |
| Modify | `tests/codex/automaticCompaction.test.ts` | Every actual request boundary uses the shared decision; no final duplicate worker. |
| Modify | `tests/codex/compactionGate.test.ts` | Admission ceiling and preferred deferral; correct the existing misleading over-trigger test name if replaced. |
| Modify | `tests/codex/compactionRetention.test.ts` | Safe active-turn source and protected-context target expansion. |
| Modify | `tests/codex/conversationRetention.test.ts` | Direct retention fixture budgets must include the approved generic image allowance; validate typed protected-context failure. |
| Modify | `tests/codex/compactionV2.test.ts` | End-to-end worker budgeting, repeated compaction continuity, full visual-inclusive validation. |
| Modify | `tests/codex/localCompaction.test.ts` | Manual mode outcomes and shared budget/projection behavior. |
| Modify | `tests/codex/canonicalHistory.test.ts` | Guarded commit and recovery of current persisted snapshots with/without diagnostic fields. |
| Modify | `tests/codex/compactionAbortCleanup.test.ts` | No adoption after abort; terminal cleanup and worker listeners remain correct. |
| Modify | `tests/codex/userFacingError.test.ts` | Distinct known causes reach appropriate actionable copy. |
| Modify | `tests/openaiCompatible/deepSeekCachePrefix.test.ts` | Update cache efficiency assertions for reported coverage while retaining existing prefix transport checks. |
| Modify | `tests/chatCompactionStatus.test.ts` | Stale attempt completion cannot replace a newer lifecycle; started attempts terminate correctly. |
| Modify | `tests/toolVisualResultMessages.test.ts` | Temporary images participate in request accounting but not durable byte storage. |
| Modify | `tests/contextUsageRefresh.test.ts` | Late idle estimate cannot overwrite current live run usage. |
| Modify | `tests/components/contextIndicatorAppearance.test.tsx` | Visible categories, truthful preview/report labels and accessible values. |
| Modify | `ARCHITECTURE.md` | After implementation, replace relevant current-flow descriptions with verified shared snapshot/coordinator behavior. |
| Modify | `DESIGN.md` | After implementation, document preferred versus required behavior and tooltip/error semantics. |
| Modify | `AGENTS_LEARNING.md` | Record the user's provider-agnostic requirement and durable design constraints, not speculative incident causes. |
| Modify | `docs/plans/provider-agnostic-context-compaction.md` | Record phase/check completion and any evidence-backed approved amendment. |

No application file is planned for deletion or rename. Remove superseded branches/functions within the affected files; do not retain an alternative old compaction flow. No package/dependency, generated prompt, catalog JSON, settings migration, or database change is planned. If compilation reveals additional direct contract consumers, list them explicitly in an amendment before editing; do not hide scope expansion as “related updates.”

## 14. Implementation sequence and checkpoints

1. **Baseline and incident reconstruction.** Confirm checkout/build identity, preserve git changes, copy the two history files into an isolated temporary directory, and read run-start initial messages plus same-run step responses using the existing replay codec. Account for branch ancestry and previous packet. Do not concatenate all events from all branches. Record missing temporary inputs/settings as unknown. Run relevant existing tests and save a sanitized baseline report. Outcome: reproduced failure branch or an explicit, bounded reconstruction limit.
2. **Shared contracts and accounting.** Implement capabilities, snapshot views, categories, method labels, output reservation and request-associated usage correction. Wire preview/live callers. Tests must prove image inclusion, no base64 explosion, and that output maxima never become context limits.
3. **Budget and selection.** Implement the exact arithmetic, typed window result and protected-target logic. Test threshold equality, small windows, configured high triggers, positive overhead correction, large latest request and current-turn reduction before model orchestration changes.
4. **Coordinator and worker integration.** Route automatic/manual attempts through one path, pass selected windows once, preflight both workers, collect usage, and enforce attempt limits. Remove final preferred compaction and obsolete null-based scheduling. Keep summary quality protections and existing separate prompts.
5. **Transactional adoption.** Add source guards under the existing history lock, drain required writes, commit before replay swap, and persist attempt outcomes. Inject disk/branch/cancellation failures to prove no false commit or wrong-branch snapshot.
6. **Transport/UI and cache metrics.** Update the current shared protocol and consumers, error catalog and tooltip. Preserve existing provider options, report cache availability correctly, and check deterministic key/prefix behavior.
7. **Integrated verification and comparison.** Run the suites below, compare deterministic scenarios, test the copied incident where possible, and do manual desktop/shared-surface checks. Document live-provider coverage honestly. Update current architecture/design only after verified implementation.

Each phase is implemented sequentially with its focused checks. There is no dual-engine feature flag. Do not expose a half-migrated contract to a running mixed-version service; restart the bundled service when testing the protocol change.

## 15. Verification matrix

Tests must fail for a concrete behavioral defect, not merely assert implementation line structure. Use stubs for deterministic workers and controlled persistence, plus existing replay/provider fixtures.

| Scenario | Required evidence |
| --- | --- |
| Ordinary small text request | No worker call; indicator and dispatched request use the same categories. |
| Temporary browser screenshot | Image counted exactly once before dispatch and after compaction; excluded from durable payload. |
| Many images, missing dimensions, Unicode | Heuristic label/reserves retained; bytes not treated as text; no claim of exact fit. |
| Preferred threshold with no reducible source | Fits admission and continues without the generic fatal error. |
| Preferred worker timeout | One failed attempt recorded, no spinner leak, request continues only if still admissible. |
| Required threshold | No model request until successful validated commit; failure exposes cause. |
| 16k and large configured windows | Output/safety arithmetic valid; no artificial minimum that admits over-budget context. |
| Huge latest request that fits admission but exceeds 10k target | Request remains intact, retention target expands; no spurious target-only failure. |
| Protected request cannot fit | Specific error before worker/provider call; original history unchanged. |
| Long single tool-heavy turn | Safe mid-turn compaction preserves next obligation and supported completed results. |
| Orphan tool call/result | No fabricated repair and no malformed provider request. |
| Summarizer smaller than source model | Worker preflight catches its actual limit; no silent provider switch. |
| Post-compaction visual reattachment | Complete request still fits admission and worker saving requirement. |
| Disk failure and commit conflict | Original live projection retained, no success marker; required compaction stops. |
| Cancellation before/after atomic write | No extra model request; only actually committed snapshots survive reopening. |
| Steer/revert/model change during workers | Stale candidate cannot overwrite new intent or branch; steering is consumed once. |
| Repeated compactions and reopened branches | Latest valid snapshot and memory, no raw-history resurrection or duplicate old handoff. |
| Provider switch including custom endpoint | Same compaction policy, reset correction, valid provider message shape, no unsupported cache assumptions. |
| Cache metrics absent or zero | Absent is unreported; explicit zero is distinguishable; no double-counted input total. |
| End of completed turn above preferred | No extra automatic worker call solely for maintenance. |
| Live and delayed preview race | Latest live model/request estimate remains authoritative. |

### Commands

Use the repository's current Node/tsx test runner; no new testing framework. Begin with focused suites:

```powershell
node --import tsx --test tests/codex/contextCapabilities.test.ts tests/codex/contextRequest.test.ts tests/codex/contextUsage.test.ts tests/toolVisualResultMessages.test.ts
node --import tsx --test tests/codex/compactionCoordinator.test.ts tests/codex/automaticCompaction.test.ts tests/codex/compactionGate.test.ts tests/codex/compactionRetention.test.ts tests/codex/compactionV2.test.ts tests/codex/localCompaction.test.ts tests/codex/compactionAbortCleanup.test.ts
node --import tsx --test tests/codex/cacheAccounting.test.ts tests/codex/canonicalHistory.test.ts tests/codex/userFacingError.test.ts tests/contextUsageRefresh.test.ts tests/components/contextIndicatorAppearance.test.tsx
npm run typecheck
npm run test:tools
```

Also run existing branch/marker/provider-continuation tests that cover touched integration contracts. Run lint on affected TypeScript files using the installed ESLint configuration, then the build used for the desktop/shared service before manual checks. Inspect any generated files from existing lifecycle scripts and retain only intentional changes. Do not report a failing baseline as fixed or silently ignore it; distinguish pre-existing failures.

Manual checks: a long text/tool run, a browser image followed by a continuation, manual compaction, reopen after compaction, revert after two compactions, cancel during compaction, a model switch, and context tooltip on desktop/mobile layout. Verify no terminal lifetime regressions and no duplicate tool group/compaction markers.

### Provider coverage

Run deterministic capability/usage fixtures for Codex, OpenAI, Anthropic, Google, Mistral, DeepSeek, and an unknown custom endpoint. Existing aliases/adapters remain governed by their transport contracts. Live smoke tests use configured credentials only; record exactly which providers/models were exercised and which were fixture-only. A lack of live credentials must be visible in the final report, not replaced by a claim that every provider was tested.

## 16. Performance and cache evaluation

Use the same source content, model configuration, tool schemas, image lifecycle and request ordering for baseline and candidate scenarios. Do not compare the incident's all-branch totals to a new single run. The diagnostic script runs deterministically without network by default and reports:

- Prepared input estimates, reserves and provider-reported input when present.
- Compaction attempts, successful commits, reasons and worker-call counts.
- Reduction achieved and steps between successful compactions.
- Worker usage/duration separately from chat usage/duration.
- Prefix identity changes between consecutive comparable requests.
- Cache-read fraction and availability coverage for provider-reported observations.
- Median and p95 local accounting/selection duration across representative small/large histories, and whether binary payload bytes were serialized for estimation.

Do not serialize image bytes to compute fingerprints or counts on every step. Reuse stable text/tool schema counts and immutable content identity within a run where correct. Do not introduce unbounded global caches or content caches containing credential-bearing payloads. Profile before adding per-message caching beyond these concrete reuse points.

Acceptance does not require a fabricated percentage cost reduction or guaranteed cache hit. It requires fewer needless worker calls in deterministic scenarios, no repeated preferred failures in one segment, no final-turn maintenance call, stable unchanged prompt prefixes, and truthful measured cache data. Any significant measured local latency regression requires explanation and correction before completion. Live cache/cost claims require comparable provider measurements including both workers.

## 17. Completion criteria

- [x] Request/preview scopes and category totals are consistent; temporary images are counted for the next actual request.
- [x] No code uses maximum output tokens as context capacity.
- [x] Output reservation agrees with the dispatched supported output limit.
- [x] Preferred versus admission behavior matches section 7, with no endless attempt loop.
- [x] Current active turns can compact at valid completed-tool boundaries.
- [x] Protected user intent, attachments, steering and supported progress survive repeated compactions.
- [x] Both workers are budgeted against their own model constraints.
- [x] Invalid/stale/unpersisted candidates never become live committed snapshots.
- [x] Manual and automatic paths share accounting, validation and commit rules.
- [x] Existing history remains readable without rewrite; no second legacy engine is introduced.
- [x] Cache reporting distinguishes unknown from miss and includes worker overhead separately.
- [x] Every started attempt terminates visibly; errors identify the known cause.
- [x] Deterministic tests, typecheck, relevant integration tests and desktop build pass, or unrelated baseline blockers are explicitly reported.
- [x] Manual and live-provider coverage is recorded accurately.
- [x] The original incident is reproduced and covered, or the unrecoverable evidence gap is stated with the new diagnostic coverage demonstrated.
- [x] Architecture/design documents describe implemented facts, and this plan's status is updated with evidence.

## 18. Remaining uncertainty and scope-change rules

The original error's exact live input is not fully captured in old records. This does not block implementing the confirmed accounting/scheduling/durability improvements, but it does block claiming a proven repair of that historical root cause without reproduction.

A generic image allowance and heuristic text count cannot guarantee capacity on arbitrary models. Provider rejection remains possible. This release reports that honestly and preserves history; exact count endpoints and verified model-specific formulas can be separate follow-up work if measurements justify their cost.

If investigation requires changing replay reconstruction, deleting existing chats, introducing a persistent format migration, building recursive summarization, adding a dependency, or changing provider transport semantics beyond the stated output/accounting contract, stop and amend this plan before implementation of that change. Routine test fixture updates and directly listed contract updates are within this plan.

## 19. Primary references and verification notes

Provider documents were consulted on 2026-10-27. Validate the particular feature against the installed SDK and configured endpoint during implementation; documentation for a public API is not proof of support in a proxy or Codex transport.

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): prefix matching and cache options are provider concerns; a stable key is not itself a cache hit.
- [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision): image accounting is model/detail dependent; do not treat a universal fixed image allowance as exact.
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): explicit cache controls and usage semantics must be handled by that provider's adapter.
- [Google context caching](https://ai.google.dev/gemini-api/docs/caching): available implicit/explicit behavior depends on API/model; do not assume a universal cache-resource API.

The design choices and numerical defaults in this plan are TideCode proposals. They are not claimed as provider-prescribed optimal settings.

## 20. Implementation and verification record (2026-10-27)

Implemented the shared request/capability modules and compaction coordinator, image-inclusive accounting with a 4,096-token generic allowance, output/uncertainty admission reserves, positive run-local usage correction, bounded preferred/required attempts, expanded protected-context retention, worker preflight and usage, guarded atomic snapshot adoption, manual/active-run exclusion, specific errors, and tooltip/settings changes. Removed the obsolete generic required-compaction gate and final-turn automatic maintenance call. Shared service protocol is 17.

The service's direct worker API still supports selecting a source for focused service callers/tests. Runtime and manual orchestration pass an already selected source, so the worker pipeline does not repeat budget/window selection. Existing provider cache option translation needed no separate implementation or new dependency. Several prelisted files needed no edits because their existing integration remained correct.

Additional confirmed accounting detail: model content provider metadata can contain very large opaque reasoning payloads. These remain available to provider replay but are excluded from text estimation and request-estimate identity. On the isolated saved run reconstruction, estimated input excluding the unknown historical system prompt fell from 207,206 to 53,481 tokens after this correction. The last provider-reported request was 98,833 tokens. These are different views and not exact historical request reconstruction; temporary visuals/settings and SDK replacements are absent. Reconstructed tool pairing is invalid, so the historical live failure's full cause is not proven.

Verification evidence:

- TypeScript checking, affected-file ESLint, and desktop/Electron/CLI build passed during implementation; final rerun results are reported with delivery.
- New coordinator tests exercise preferred timeout deferral and suppression, required blocking, failed disk-save adoption, persistence ordering, image-inclusive post-projection admission, protected-request target expansion, cancellation, invalid pairs, and no-op small requests.
- A shared-runtime test with a stub transport and isolated history verifies temporary-image dispatch/counting and completion without a final maintenance worker. No external provider call or user-history mutation is used.
- Canonical storage tests validate stale-source rejection under the file lock and successful snapshot readability. Existing branch/replay/worker continuity tests exercise the unchanged storage format.
- A broad timed tool-suite comparison found no new failing test names: changed checkout 827 tests, 795 passed, 31 failed, one cancelled; clean baseline 807 tests, 774 passed, 32 failed, one cancelled. The baseline-only failure concerned an unsynchronized generated prompt template. Both runs stalled in the same terminal lifecycle test; those test subprocesses were stopped to obtain reports. These totals describe that comparison run, before final focused assertions were completed.
- Baseline comparison separately confirmed all seven existing failures in Code Mode retention and provider/tool continuation tests. They were not hidden by skipped tests or unrelated implementation changes.
- Deterministic scenarios at 256k capacity distinguish 210,004 estimated tokens as preferred/optional and 230,004 as required. A 4 MB temporary image is estimated at 4,130 total tokens, of which 4,096 are the image allowance. No base64-size token explosion occurs.

Diagnostic commands:

```powershell
node --import tsx scripts/diagnoseContextCompaction.ts --scenarios
node --import tsx scripts/diagnoseContextCompaction.ts --canonical <isolated-copy.json> --output <new-report.json>
```

The diagnostic script defaults to no provider calls, never implicitly opens real user history, rejects overwriting its source, and emits counts/IDs rather than transcript text. Copies of both incident files were used, leaving the originals unchanged.

Remaining verification limits: no paid live-provider smoke tests or cache-dollar measurements were performed; provider handling was checked through installed SDK contracts and deterministic fixtures. No interactive desktop/mobile walkthrough was performed. Runtime integration, renderer tests and compiled desktop artifacts provide automated coverage, not a claim of interactive or all-provider verification. Arbitrary custom-provider capacities remain user-configured when no verified capacity exists, and image/text counts remain heuristic. Worker preflight likewise uses configured capacity without pretending that an unknown summarizer's provider limit was discovered.

Final focused verification: 170 tests passed with no failures or skipped tests. This focused group excludes the independently confirmed baseline Code Mode retention failure; the broad-suite baseline comparison above still records it. Final TypeScript checking, affected-file ESLint and desktop/Electron/CLI build all passed after the last integration changes.

Manual integration also passed with a DeepSeek worker and a Codex source model, verifying that the source replay/provider identity is retained independently of the summarizer. SHA-256 comparison confirms both original incident history files remain byte-identical to the initial copies.

Final automated checks: the 170-test focused group passes with no failures, cancellations, or skips; affected-file ESLint and git diff whitespace checks pass. The shared-runtime and manual cross-provider integration tests are included.
