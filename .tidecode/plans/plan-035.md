---
status: draft
---

# Goal
Make TideCode Code Mode substantially more reliable and more capable: accept normal JavaScript and familiar imports, including HTTP client use, without confusing freeform input with unrestricted access to the host. Preserve Plan Mode, user permissions, cancellation, and trustworthy records of what actually ran.

This is a read-only source review and an implementation proposal. No web search, source changes, or test execution were performed. Findings below distinguish directly observed implementation behavior from risks that still need executable regression tests. Implementation requires user approval and Agent Mode.

## Key findings and evidence

### 1. The reported HTTP error is deliberate policy, not a freeform formatting failure
- `electron/chat/shared/tools/factory.ts:158-161` constructs every provider-facing executor with `terminalExecutionMode: 'sandbox'`, regardless of the terminal's Full Access setting.
- `electron/chat/shared/codeMode/executor.ts:510-527` rejects dynamic imports and blocked runtime identifiers before starting the worker. This is the source of the exact reported message. No earlier tool call in that program executes.
- The same executor already has a full-runtime branch (`configureRuntime`, approximately lines 169-181) exposing require, fs, http, processes, and workers. `tests/codex/codeMode.test.ts:656` exercises it directly, but the product factory does not select it. The test around line 1716 explicitly expects terminal Full Access NOT to enable direct Node access.
- `src/components/chat/TerminalExecutionModeSelectorField.tsx` describes Full Access as host-shell execution. Silently changing that existing setting into permission for arbitrary in-process JavaScript would expand an existing trust decision.

### 2. Freeform transport does not mean an unrestricted JavaScript environment
- `electron/chat/shared/tools/metaTools.ts:54-63` has a grammar whose SOURCE rule accepts any nonempty text. It does not validate JavaScript, protect payload escaping, or support imports itself. The optional pragma has no corresponding execution semantics in the inspected executor.
- OpenAI/Codex receive raw source; other providers receive `{ source: string }`. The description is otherwise shared. These transport differences are already covered by tests and documented in `docs/plan/plan-025.md`.
- Execution and validation both use AsyncFunction. Consequently, top-level return/await work, but static `import http from 'node:http'` is not valid in that function body even if the keyword blacklist is removed. Dynamic imports are separately denied in sandbox mode.
- `normalizeCodeModeSourceInput` handles a string or source object but does not classify accidental fences, double-encoded source envelopes, or mixed source/payload transport mistakes.

### 3. The blacklist can reject harmless JavaScript
- `validation.ts:1112-1139` uses word/pattern matching after masking literals/comments, not binding-aware JavaScript analysis.
- Source-derived examples: `const http = { status: 200 }; return http.status;` and `return { module: 'ui' };` match blocked names despite requesting no host capability. These examples were not executed in this review; add regression tests to prove the current failure and the fix.
- Existing tests cover forbidden words inside strings, regexes, comments, and template text, but those protections do not solve local variables and property names.
- A lexical denylist is also not sufficient evidence of security against computed access, aliases, prototype paths, or indirect loading. Existing worker restrictions remain important; this review does not claim a demonstrated escape.

### 4. Formatting really is a separate reliability problem
- `validation.ts` is 1,168 lines and includes nested-template handling, triple-quoted string conversion, missing-colon repair, regex-escape repair, terminal command repair, and brace balancing.
- The general brace-balancing fallback uses a small custom scanner, not the JavaScript grammar. A candidate compiling successfully proves syntax, not that the assistant's intended payload or control flow was preserved.
- `normalizeCodeModePatchTemplateLiterals` intentionally gives complete patch templates special literal-data semantics before normal syntax validation. Keep this compatibility behavior; document it as an explicit exception rather than claiming all payloads follow ordinary JS template interpolation.
- Repairs currently replace executable source without returning a repair kind or source-position mapping. Syntax errors try to extract a `tidecode-code-mode.js` location although validation constructs an unnamed AsyncFunction. Reliable original-source diagnostics need a deliberate parser/source map.
- These mechanisms explain credible failure classes, but no production transcript/error distribution was supplied. It would be unsupported to claim which one accounts for most real user failures.

### 5. More prompt prohibitions alone will not fix this
- `promptContract.ts` explicitly calls Code Mode tool-only, bans imports, Buffer, and network APIs, and says tools is a global binding; implementation actually supplies tools as a function parameter.
- `metaTools.ts` adds a long routing/catalog contract, including APIs that may be unavailable under the active Plan Mode allowlist. The Plan context explains the difference, but the model must reconcile multiple sources.
- `toolCallRepair.ts` already repairs misrouted inner-tool calls into Code Mode. Preserve this useful deterministic repair; do not solve routing errors by exposing duplicate provider tools.
- Prefer one generated capability description, a small mode-specific availability block, and a few valid examples over additional repeated warnings.

### 6. Enabling the existing full branch is not an end-to-end fix
- Native filesystem and process calls bypass registry tool records, tool allowlists, workspace mutation controls, and Plan Mode restrictions. Native HTTP also bypasses operation tracking and network-specific cancellation/accounting.
- The worker creates require relative to the app process cwd; workspaceRootPath is sent to the worker but is not used to establish module resolution. Workspace imports would be surprising.
- Tool promise draining tracks tools calls, not arbitrary callback HTTP operations. A callback request can outlive the returned program unless explicitly awaited/tracked.
- Limits currently cover source bytes, final output bytes, tool-call count, and a 30-minute wall timeout. Worker memory, intermediate bridge message size, and non-tool I/O need explicit budgets before broadening capabilities.
- `resolveReturnedValue` recursively converts objects using Object.keys. Date/Map/Error/native response instances need defined behavior instead of silently becoming empty or misleading objects. Console output is discarded in sandbox mode. These are adjacent usability problems relevant to general-purpose JavaScript.

## Recommended permission decision
Do NOT merely remove `http` from the blacklist or wire terminal Full Access to the current unrestricted worker.

Recommended product behavior: **capability-controlled imports**. Let models use familiar import syntax and useful libraries; authorize side effects at the host capability boundary rather than rejecting words. Support HTTP client imports through a documented controlled implementation. Preserve ordinary tools APIs as the supported route for workspace mutations and managed terminals. This meets the concrete HTTP/import goal without pretending arbitrary native code can be classified as safe by scanning it.

A materially different alternative is **trusted unrestricted Node execution**. That really can provide native modules and arbitrary installed packages, but cannot honestly promise to prevent only the very dangerous actions. It would need an explicit independent trust grant, separate-process isolation and lifecycle management, and a different threat model. It must not be silently enabled for existing Full Access users. This alternative is not part of the recommended implementation below.

Approval gate: confirm capability-controlled imports versus genuinely unrestricted trusted Node before implementing the runtime expansion. Reliability fixes below are useful under either choice. The recommended plan deliberately does not claim complete native node:http or arbitrary npm compatibility.

## End-to-end implementation specification (recommended option)

### 1. Establish policy and measurable regression cases first
**Modify** `electron/chat/shared/codeMode/types.ts` to introduce an explicit Code Mode capability policy independent of terminalExecutionMode, structured execution diagnostics, repair metadata, and resource budgets. Keep old execution/result fields compatible. Use separate policy dimensions for chat mode, import availability, and side-effect permissions; do not derive permissions from model source or a pragma.

**Create** `electron/chat/shared/codeMode/runtimePolicy.ts` to compute the policy from trusted host context. Plan Mode remains planning-safe regardless of terminal mode. Baseline pure computation is allowed. Files, terminals, and existing connected services retain their current host authorization paths. Network access is an explicit capability, not a property of a variable named http.

**Modify** `electron/chat/shared/tools/factory.ts` to pass the resolved policy to both executor and description generation, and establish the Plan Mode tool restriction as an executor-level ceiling as well as a per-run allowlist. An invocation may narrow, never widen, that ceiling. Do not enable the existing full branch as a shortcut.

**Modify** `tests/codex/codeMode.test.ts`, `tests/codex/codeModeReliability.test.ts`, and `tests/codex/agentTools.test.ts` to capture the source-derived failures before replacement. Preserve tests for restrictive tool allowlists and no execution on syntax/preflight failure.

### 2. Normalize, parse, and compile one well-defined source language
**Create** `electron/chat/shared/codeMode/compiler.ts`. Pipeline: transport normalization -> explicitly supported literal-payload normalization -> parse -> narrowly justified repair if needed -> parse again -> scope-aware capability/import analysis -> compile -> execute. Every preflight failure occurs before side effects.

Use a maintained JavaScript parser with top-level await/return support and original line/column ranges; choose and pin the parser during implementation after checking local dependencies. **Modify** `package.json` and `package-lock.json` together if a new runtime parser dependency is necessary. Do not use a tolerant parse that silently executes malformed source. No TypeScript promise in this change.

Support common static default/named/namespace imports and dynamic import of approved literal module names by lowering them to a non-public controlled loader. Preserve top-level await and return. Canonicalize `http` and `node:http`; never use unrestricted require as the resolver. Reject unknown/computed module specifiers with a capability-specific diagnostic before execution where statically determinable. Scope-aware analysis must distinguish user bindings, property keys, and executable template expressions. Runtime checks remain authoritative even when preflight cannot determine a capability.

**Modify** `electron/chat/shared/codeMode/validation.ts` to delegate general parsing/positions to the compiler. Keep narrowly tested patch/payload compatibility helpers. Remove heuristic brace insertion and regex-based capability enforcement from the security boundary. Auto-repair only recognized, unambiguous malformed shapes; do not broadly rewrite a valid program's strings or control flow. Record which deterministic repair occurred. Ambiguous cases return a precise retry instruction without running anything.

**Modify** `electron/chat/shared/tools/metaTools.ts` to keep provider envelopes transport-only. Simplify the overlapping grammar to nonempty source unless a real pragma feature is intentionally retained; never treat a pragma as permission. Recognize a complete accidental outer fence or a single clearly valid source envelope only when unambiguous. Do not recursively unwrap arbitrary JSON or rewrite JavaScript literals. The compiler receives one canonical source string.

### 3. Implement useful imports without untracked host access
**Create** `electron/chat/shared/codeMode/moduleLoader.ts` for the approved module table and canonical resolution. Initially support audited computational functionality such as path manipulation, URL handling, bounded Buffer operations, and the controlled HTTP/HTTPS client interface. Keep request-only APIs explicit; no implicit server listeners, raw sockets, host process, Electron, arbitrary filesystem loader, or automatic package installation. Document unsupported exports rather than emulating the entire Node ecosystem.

**Create** `electron/chat/shared/codeMode/networkBridge.ts` for host-authorized request handling. Imported HTTP/HTTPS clients and a fetch-style convenience API use the same host path. Define and test the supported subset: request/get, request completion, status, headers, bounded body consumption, cancellation, and error delivery. Do not promise full stream/Agent/proxy/server compatibility. Unknown options fail clearly instead of being silently ignored.

The host checks the current mode and network grant before every request. Default-deny ungranted requests, local/private/link-local destinations and metadata endpoints; require explicit authorization for local development services. Validate resolved addresses and pin the actual connection target; recheck every redirect. Reject unsafe schemes, credential-bearing URLs, TLS verification bypasses, and unsupported proxy/CONNECT behavior. No ambient application credentials, cookies, or environment secrets. A GET alone is not proof an operation is harmless. Requests capable of external mutation need explicit authorization, not method-name assumptions.

The approval integration API was not established by this review. Discover and reuse a suitable existing authorization surface during implementation; if none exists, add a minimal host-confirmed grant flow and identify its UI/settings files before coding that part. Do not invent an automatic allow decision. This is an implementation dependency, not permission to omit network controls.

Record network operations in bounded execution metadata, scrub secrets, cap concurrency/request/response bytes, and attach all requests to execution cancellation. Cancel outstanding sockets before reporting completion or abort. Network partial failures must not trigger automatic replay of prior side effects.

### 4. Tighten executor lifecycle and data behavior
**Modify** `electron/chat/shared/codeMode/executor.ts` to execute compiled source with the controlled loader and the injected tools binding. Keep ambient native host APIs unavailable. Worker termination alone must not be the only cleanup for host-mediated I/O. Add memory/resource limits appropriate to the actual shipped Node/Electron runtime and bound bridge inputs before cloning expensive data. Preserve separate long-running tool waits; do not impose a short global timeout that breaks builds.

Use the workspace root explicitly for any approved workspace-relative resolution; built-in aliases do not depend on cwd. Do not load workspace packages in the controlled initial policy.

Define output conversion deliberately: JSON primitives/arrays/objects, bounded byte arrays, Date -> ISO string, and clear behavior for Error/Map/Set. Reject unsupported live handles/functions/cycles with original-source context. Avoid walking getters or huge module/response objects as ordinary output. Preserve detached tools-promise draining and explicit recovery behavior. Capture bounded console diagnostics without logging secrets or replacing an explicit returned result.

Emit diagnostics with phase (transport/parse/policy/runtime/tool/timeout/abort/output), stable error code, original location where known, policy, repair kind, and counts of completed/failed/in-flight operations. State 'No operation ran' only when proven. Do not automatically rerun a failed program after a write, terminal command, or request may have happened.

### 5. Make the model contract match the runtime
**Modify** `electron/chat/shared/codeMode/promptContract.ts` and `electron/chat/shared/tools/metaTools.ts` to describe the actual execution environment, approved import syntax, supported client subset, tools binding, return types, payload exception, and mode-specific restrictions. Separate stable API documentation from a compact active-availability block to avoid unnecessary prompt-cache churn. Preserve provider semantic parity.

**Modify** `electron/chat/shared/codeMode/toolCallRepair.ts` only as needed to retain deterministic misrouted-call repair and enforce the same executable capability ceiling. Do not convert unknown tools or malformed arguments into guessed calls.

**Modify** `src/components/chat/TerminalExecutionModeSelectorField.tsx` help text only if necessary to clarify that terminal Full Access and Code Mode capabilities are distinct; do not expand the setting's meaning or migrate existing users to native access.

**Modify** `electron/chat/shared/compaction/codeModeReceipts.ts` to retain compact side-effect/partial-failure receipts for the new network capability without inserting raw requests, secrets, or full source into continuation context. Keep older receipts readable.

**Create** `docs/code-mode-runtime.md` documenting source syntax versus permissions, the import/export support matrix, Plan Mode behavior, payload semantics, diagnostics, cleanup guarantees, and limitations. Preserve historical plans; no source moves or deletions are proposed.

## Verification and acceptance criteria

**Create** `tests/codex/codeModeImports.test.ts` and `tests/codex/codeModeNetwork.test.ts` for the new behavior. Use local controlled fixtures/mocks, never public internet during the test suite. Add scope/parse cases to the existing reliability suite and receipt cases to `tests/codex/codeModeCompactionReceipts.test.ts`.

Required proofs:
1. Harmless local identifiers/property names http, module, process, and Buffer no longer cause policy rejection. Executable access to ungranted capabilities remains blocked, including aliases/computed access at runtime.
2. Raw OpenAI/Codex and source-envelope providers deliver identical canonical source and execution semantics. Empty/malformed/mixed envelopes fail precisely. UTF-8, CRLF, regexes, Windows paths, JSX/TSX payload text, nested backticks, `${...}`, and patch literals preserve exact bytes where required.
3. Approved static and dynamic HTTP imports work; unauthorized network calls explain the actual permission requirement rather than saying http is forbidden JavaScript. Unsupported module exports are honest and deterministic.
4. Plan Mode cannot mutate workspace files or invoke forbidden services through tools, imports, callbacks, computed access, direct executor calls, or Full Access terminal settings.
5. Network grants, denied destinations, DNS/redirect checks, body caps, TLS defaults, cancellation, timeout, and pending callback requests are exercised. No request survives cleanup; no retry duplicates an external mutation.
6. Preflight failures run zero operations. Runtime partial failures preserve accurate receipts. Ambiguous syntax repairs do not execute. Valid source retains meaning, apart from the explicitly documented patch literal compatibility rule.
7. Output behavior is stable for Date, bytes, Map/Set, Error, cycles, getters and oversized values; console-only programs receive bounded useful diagnostics.
8. Worker and host memory/output/concurrency limits fail cleanly; infinite loops terminate; existing terminal cancellation and long-running tools still work.
9. Existing provider transport/continuation, Plan tools, apply_patch, tool-call repair, result formatting, and compaction tests remain green. Update tests that explicitly enshrine the old ban to assert the new policy, not simply delete them.

Implementation verification commands: targeted `node --import tsx --test` runs for the named test files and related existing suites, `npm run typecheck`, targeted lint using repository scripts/configuration, and `git diff --check`. These commands have NOT been run during this review.

Measure the regression corpus by failure category, exact-payload preservation, first-attempt success, unsafe/ungranted operation count, and retry count. Compare baseline and changed runtime using identical inputs. Do not claim a model reliability percentage from passing handcrafted tests; a later user-authorized replay of sanitized real failures is needed to measure that.

## Delivery order and scope
1. Confirm the permission decision; capture baseline regressions and introduce host policy types.
2. Implement compiler/diagnostics and conservative repair behavior.
3. Implement module and network capability paths with authorization/cleanup tests before enabling them.
4. Integrate executor, factory, provider descriptions, results and receipts.
5. Run the complete goal-focused verification, document limitations, and only then enable the approved capability policy.

Keep the single model-facing Code Mode tool, structured workspace tools, provider transport conventions, and existing user data. No arbitrary package installation, blanket native host access, unrelated refactors, or claims of perfect dangerous-code detection. Runtime expansion remains gated on the user's permission-model choice; no source implementation is authorized by this review alone.
