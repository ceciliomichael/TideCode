# Code Mode V2 owned interpreter

## Goal
Replace Tidecode's current Worker/AsyncFunction-based Code Mode execution with a reliable Tidecode-owned Code Mode language and interpreter while keeping the product strictly Code Mode-only. The model must continue to see one outer capability, `code_mode`; every filesystem, terminal, MCP, search, edit, write, and other side effect must happen through `tools.*` inside Code Mode.

## Important findings
- Tidecode already runs normal chat in `code_mode`; do not introduce hybrid or direct model-visible tools.
- The current executor parses/repairs generated JavaScript and then executes it in a Node Worker with `AsyncFunction`, creating grammar, sandbox, repair, and concurrency failure modes.
- The existing Tidecode tool registry, schema validation, permissions, workspace scoping, terminal subsystem, MCP integration, receipts, provider adapters, and result bounding are valuable and should remain host-owned.
- OpenCode's strongest design is structural confinement: parse a documented JavaScript subset and execute it with an owned interpreter where external authority exists only through injected tools.
- Pi's strongest relevant reliability feature is resource-aware mutation serialization, especially for concurrent edits/writes to the same physical file.

## Code Mode language contract
- Define and document Tidecode Code Mode as a JavaScript-like orchestration language, not general Node.js JavaScript.
- Support the constructs models need for tool orchestration: literals, arrays, objects, variables, lexical scopes, property access, assignment, conditionals, switch, loops, break/continue, functions, async functions, closures, destructuring, spread/rest, template literals, `await`, `try/catch/finally`, `throw`, top-level `await`, and top-level `return`.
- Provide a small owned standard library for common Array, String, Object, Math, JSON, and Promise operations, including bounded `Promise.all`/`allSettled` behavior.
- Explicitly reject imports, require, classes, generators, eval, Function construction, Node/process globals, direct filesystem/network APIs, WebAssembly, workers, dynamic module loading, arbitrary prototype traversal, and other host escape paths.
- Parse and validate against one intentional grammar so accepted source has the same semantics the interpreter executes. Unsupported syntax must return deterministic, location-aware errors with useful guidance instead of source rewriting.
- Keep only narrow structured argument compatibility normalization when justified; retire broad JavaScript repair heuristics as V2 replaces V1.

## Interpreter and value model
- Add a Code Mode V2 engine beside the current executor first, with clear modules for parsing, supported-syntax validation, environments/scopes, expression and statement evaluation, functions/control flow, safe built-ins, errors, limits, tool runtime, result serialization, and traces.
- Execute the parsed AST directly. V2 must not use `AsyncFunction`, `eval`, `Function`, or a general Node execution context for model source.
- Use explicit interpreter values and sanitize tool outputs into plain Code Mode-safe data so host objects, prototypes, functions, streams, buffers, sockets, Electron objects, and other ambient capabilities cannot leak into programs.
- Implement lexical environments and internal control-flow signals so return/break/continue/program throws are distinct from interpreter bugs.
- Add deterministic limits for source size, interpreter steps, call depth, tool-call count, concurrent tool calls, execution time, and returned result size. Initial defaults should stay close to current practical limits while adding a bounded concurrency target of about 8.

## Capability and tool runtime
- Project the existing Tidecode tool registry into a Code Mode capability namespace. All external effects must enter through `tools.*`, then pass through existing schema validation, permission checks, workspace scoping, native execution, and result sanitization.
- Keep core coding capabilities stable and pre-documented, including read/list/glob/grep/edit/write/apply_patch/terminal equivalents where currently supported.
- Standardize failure semantics: successful tool calls resolve to values; unsuccessful calls throw sanitized Code Mode tool errors. Normal empty results such as grep finding no matches remain successful values.
- Add a global tool scheduler with bounded concurrency so model-generated `Promise.all` cannot flood the host.
- Add a Pi-style resource-aware mutation queue for edit/write/apply_patch and other file mutations. Mutations to the same canonical physical file must serialize while independent files may proceed concurrently; cancellation must not release a mutation lock until an already-started underlying write has settled.
- Separate long-lived terminal process lifetime from Code Mode program lifetime by using terminal/session capabilities rather than requiring one interpreter invocation to remain alive indefinitely.

## Tool discovery and MCP
- Keep the model-facing outer tool list Code Mode-only. Do not expose native tools or a separate outer discovery tool.
- Provide `tools.$codemode.search(...)` inside Code Mode for native/dynamic/MCP capability discovery, with query, namespace, pagination, and useful detail levels.
- Return exact callable Code Mode paths and schemas/signatures from search results so the model does not guess tool names.
- Add deterministic namespace-safe projection for MCP/server/tool names, including stable collision handling for the session.
- Filter discovery through the same host authority/permission model used for execution.

## Errors, results, and observability
- Define a stable error taxonomy covering parse errors, unsupported syntax, reference/type errors, unknown tools, invalid tool arguments, permission denial, tool execution failure, step/tool-call/time/output limits, cancellation, and internal execution failure.
- Return compact, sanitized, deterministic model-facing errors with source locations where relevant. Keep detailed native stacks/diagnostics in internal logs rather than exposing them to the model.
- Preserve Tidecode receipts/compaction behavior by recording tool calls, outcomes, duration, step counts, and final program result without changing Code Mode semantics.
- Add failure classification/metrics so real-session reliability can be measured by parse failure, unsupported syntax, bad arguments, unknown tools, tool failures, limits, provider formatting, and retries.

## Provider and prompt integration
- Normalize every provider's outer representation into one internal request shape such as `{ code: string }` before V2 execution. Provider-specific freeform/JSON behavior must stay outside the interpreter.
- Keep one model-visible outer tool, `code_mode`.
- Replace the current compatibility-heavy Code Mode prompt with a concise V2 contract: supported JavaScript-like syntax, all effects through `tools.*`, discover unknown capabilities with `tools.$codemode.search`, await tool calls, use try/catch for expected failures, use Promise combinators only for independent work, return useful results, and never invent/import host APIs.
- Keep Sandbox/Plan/Full Access differences in host capabilities and permissions, not in language semantics. Full Access must use the same V2 interpreter; arbitrary Node or shell work remains an explicit terminal/host capability.

## Migration and cleanup
- Add an internal V1/V2 engine selector only for development/canary comparison; this is not hybrid orchestration and the model still sees only `code_mode`.
- Never replay V1 and V2 simultaneously against side-effecting tools. Shadow comparison may parse/validate source only.
- Port existing user-visible Code Mode regression behavior to V2, classify V1-only repair/import/sandbox tests, and replace obsolete repair expectations with deterministic language/error tests.
- Build a regression corpus of minimized real model-generated Code Mode failures from supported providers and add each meaningful production failure class as a test.
- After V2 meets the reliability bar, make it the default engine, retain V1 only briefly as an internal fallback if needed, then remove the Worker/AsyncFunction sandbox, module-lowering path, broad source-repair machinery, and obsolete misrouting/runtime code. Simplify direct/hybrid orchestration infrastructure only after V2 is complete, as separate cleanup within the same approved end state where safe.

## Verification
- Add focused unit tests for parsing, supported/unsupported syntax, lexical scope, closures, control flow, async/await, Promise combinators, safe built-ins, deterministic errors, value serialization, step/depth/time/output/tool-call limits, cancellation, and host-escape attempts.
- Add tool-runtime tests for schema validation, permission denial, sanitized failures, capability projection, search, MCP namespace collisions, bounded concurrency, and same-file mutation ordering/abort behavior.
- Add end-to-end Code Mode-only integration tests for read/search/edit/write/test workflows, multi-file work, terminal sessions, Plan/Sandbox/Full Access authority differences, MCP discovery/execution, receipts/compaction, and provider request normalization.
- Preserve and port the existing Code Mode reliability/output/repair/compaction coverage where behavior remains intentional.
- Run the targeted V2 and existing Code Mode suites, relevant tool tests, `npm run typecheck`, changed-file ESLint, and `git diff --check`. Use the smallest additional build/integration checks needed for touched runtime paths.

## Dependencies
- Prefer the existing Acorn parser and current Tidecode dependencies. Do not add a general sandbox/runtime dependency unless implementation proves a small, maintained library is materially safer or simpler than the owned interpreter pieces required here.
- Any new dependency must be justified before addition and must not reintroduce ambient host execution.

## Scope
- In scope: complete Code Mode V2 language/runtime, tool capability bridge, discovery, concurrency/mutation safety, deterministic errors/results, provider/prompt integration, migration, tests, observability needed for reliability, and retirement of the superseded V1 execution path.
- Out of scope: hybrid orchestration, direct model-visible native tools, unrelated UI/product changes, unrelated tool rewrites, or adding general-purpose Node/module execution to the Code Mode language.

## Completion criteria
- The model has exactly one normal action tool: `code_mode`.
- Real coding, terminal, and MCP workflows are fully possible through `tools.*` inside Code Mode.
- Model source is interpreted by Tidecode and never executed through `AsyncFunction`/eval/general Node execution.
- Every accepted syntax construct is explicitly supported; unsupported constructs fail deterministically with useful diagnostics.
- Host authority remains behind the existing tool registry and permissions; tool inputs/outputs are validated and sanitized.
- Tool concurrency is bounded and same-resource mutations cannot race.
- Infinite/runaway programs, excessive calls, oversized results, cancellation, and malicious escape attempts fail safely and predictably.
- V2 passes the planned targeted, regression, security, typecheck, lint, and diff verification before V1 is removed.
