# Plan: Markdown-first tool contracts (review draft)

**Status:** Proposal only. Awaiting approval. No runtime or tool documentation implementation changes.

## Root cause (verified)
The 16 native Markdown files in `electron/chat/shared/ai/tools/` are already loaded into each tool's registered `description` by `ai/registry/documentation.ts`. But `available/get/get.ts` bundles that Markdown as `description`, appends a JSON-stringified input schema inside `signature` (via `codeMode/v2/toolRuntime.ts`), and repeats the schema as `inputSchema`. The result is a bulky JSON object. Most native .md files also repeat generic four-line usage boilerplate, which belongs in shared `exec.md`. The native Markdown files should remain the authority for tool instructions.

## Proposed behavior
`tools.available.get({ name: "tools.read" })` yields one concise **Markdown string**, not JSON. It contains the original tool-specific Markdown plus a generated TypeScript-like callable/argument block derived from the registered schema. **Runtime retains the complete machine-readable JSON schema** for validation and host permissions. No duplicate JSON signature or top-level schema is sent to the model. The same Markdown is returned for automatic recovery and shown in the nested contract receipt. Native/API names and MCP search visibility stay unchanged.

### Example target response, native read (illustrative)
```md
# tools.read
Read an existing file or directory.

```ts
await tools.read({
  path: string,        // required
  limit?: number,      // max 500 lines
  offset?: number,     // 1-based
  cursor?: string      // reuse next_cursor verbatim
})
```

Paths resolve from the workspace; supported read-only aliases are
@workspace/, @attachments/, @skills/, and @tool-output/.
Continue long output using the returned cursor/offset.
```
The actual formatter must preserve any additional schema restrictions. Do not change model-facing returned values from ordinary tool execution.

## Full per-tool Markdown drafts
These are content outlines for each replacement .md, not claims about unchecked exact argument signatures. The actual typed parameter blocks are generated from each current API schema.

| Source file to modify | Draft body-specific content (besides heading and generated signature) |
|---|---|
| `tools/read/read.md` | **# tools.read**. Read an existing file/directory. Workspace aliases and 1-based line offsets; bounded limits; reuse cursor verbatim. |
| `tools/list/list.md` | **# tools.list**. Enumerate an existing directory; scoped paths; paginate results where supported. |
| `tools/glob/glob.md` | **# tools.glob**. Find files matching the exact glob; document base path, supported glob patterns and limits. |
| `tools/grep/grep.md` | **# tools.grep**. Search contents with exact query; document supported pattern/regex options, scope, and truncation. |
| `tools/write/write.md` | **# tools.write**. Write exact file content; preserve creation/overwrite behavior; prefer exec payloads for arbitrary source. |
| `tools/patch/patch.md` | **# tools.patch**. Apply an exact patch; inspect source first; Plan Mode only modifies active plan. |
| `tools/plan/create/create.md` | **# tools.plan.create**. Create a canonical plan with the required content and optional title (as schema permits); only one active plan. |
| `tools/terminal/execute/execute.md` | **# tools.terminal.execute**. Start a terminal command; keep `session_id`; continue rather than repeating commands; specify bounded wait behavior. |
| `tools/terminal/read/read.md` | **# tools.terminal.read**. Read/poll an existing session; use the returned `session_id` and continuation behavior. |
| `tools/terminal/interact/interact.md` | **# tools.terminal.interact**. Send input to an existing session; distinguish writing, waiting and output. |
| `tools/terminal/terminate/terminate.md` | **# tools.terminal.terminate**. Terminate a known active session; preserve the exact ID and termination options. |
| `tools/skill/list/list.md` | **# tools.skill.list**. List enabled skills, 10 per page; optional 1-based page. |
| `tools/skill/search/search.md` | **# tools.skill.search**. Search skills by name or description using required query. |
| `tools/skill/load/load.md` | **# tools.skill.load**. Load full instructions for exact enabled skill using required name. |
| `tools/available/search/search.md` | **# tools.available.search**. Discover exact names via query/namespace/limit/offset. Return names and pagination only; MCP search before get. |
| `tools/available/get/get.md` | **# tools.available.get**. Retrieve exact available tool instructions in Markdown; no permissions granted; MCP requires prior discovery. |

Each final native .md should have a clear heading, one sentence defining purpose, and only task-specific rules. Remove the repeated "use registered signature / don't guess / await / follow mode authorization" bullets from individual files; keep those four universal rules once in shared `exec.md`.

## MCP contract design
External MCP tools do not have bundled native .md files. Use their discovered description verbatim as lower-trust tool documentation, plus the same generated typed argument block. Formatter must handle nested objects, arrays, required/optional fields, enum/union/nullable types, defaults, ranges, formats, patterns and advanced JSON-schema constructs. When a constraint cannot be safely expressed in TypeScript comments, preserve that constraint in a **small localized JSON-schema code block**, never silently omit it. Preserve restrictions and permission checks, and bound pathological schemas.

## Planned structure
```text
electron/chat/shared/ai/
  exec/{exec.ts,exec.md}                              [modify]
  tools/available/get/{get.ts,get.md,contractFormatter.ts [create]}
  tools/available/search/search.md                    [modify]
  tools/{read,list,glob,grep,write,patch}/*.md         [modify]
  tools/plan/create/create.md                         [modify]
  tools/skill/{list,search,load}/*.md                  [modify]
  tools/terminal/{execute,read,interact,terminate}/*.md [modify]
electron/chat/shared/codeMode/v2/toolRuntime.ts       [modify]
src/components/chat/{ToolInvocationBlock.tsx,toolInvocationDiscoveryPresentation.ts} [modify if needed]
tests/codex/{execNativeTools.test.ts,toolInvocationPresentation.test.ts} [modify]
tests/codex/toolContractFormatter.test.ts             [create]
ARCHITECTURE.md, DESIGN.md                            [modify]
```

## Implementation sequence after approval
1. Inspect all 16 registered input schemas and current documentation; finalize the exact per-tool bodies and constraints. Preserve unrelated modifications.
2. Write `contractFormatter.ts` with typed Markdown and safe compact fallback for exotic MCP schema features.
3. Change `available/get/get.ts` and `codeMode/v2/toolRuntime.ts` to use Markdown for explicit get and automatic recovery. Keep per-contract nested receipts and grouping. Adjust UI only to render retrieved Markdown correctly, not JSON.
4. Rewrite the 16 .md files listed above, removing common boilerplate while retaining specific behavior and valid exact usage.
5. Update `exec.ts` and `exec.md` for Markdown return contracts and shared policies.
6. Update tests and documentation; verify typecheck, focused native/MCP and UI tests, CLI documentation packaging and production build.
7. Measure old/new approximate token counts for `read`, `patch`, `terminal.execute` and representative nested MCP schemas. Reject savings that delete needed constraints.

## Review/acceptance criteria
- Native `get` retrieves its corresponding .md instructions, plus the minimal precise typed API declaration; no duplicate input schema/JSON blob.
- The model can call every native and permitted MCP API correctly using that contract alone plus shared exec rules.
- Auto-retrieval gives the same contract as explicit get and remains recoverable; no unauthorized tool can be executed.
- One contract retrieval = one named expandable receipt, including multiple retrievals in one exec.
- Tool execution data, grouping, Plan Mode restrictions, permissions, and existing file/terminal results are unchanged.
- Tests verify required/optional parameters, advanced MCP schema fidelity, malformed input, and measurable output size.

**No runtime, tool .md, or validation changes are authorized by this planning file alone.**
