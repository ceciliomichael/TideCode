# Dynamic Tools System – Design Plan

## 1. Overview

A tool system where the AI **never** receives a static list of concrete tools in its prompt.  
Instead, it only ever sees three meta-tools that allow it to discover, inspect, and execute any available tool on demand.

| Meta-tool            | Purpose                                      |
|----------------------|----------------------------------------------|
| `list_tools`         | List or search available tools               |
| `get_tool_schema`    | Get the full JSON schema of one or more tools |
| `execute_tool`       | Execute a tool by ID with arguments          |

### Goals

- Keep context small (only 3 tool schemas instead of dozens or hundreds)
- Support large and growing tool catalogs
- Allow tools to be added, removed, or updated without changing the system prompt
- Enable fine-grained permission control per session/user
- Keep the system predictable, debuggable, and reliable
- Remain compatible with major providers (OpenAI, Anthropic, etc.)

---

## 2. Architecture

```
┌─────────────────┐
│   AI Model      │
│  (only sees     │
│  3 meta-tools)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Meta-Tool      │
│  Router         │
└────────┬────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
list_tools  get_tool_schema  execute_tool
    │         │                │
    ▼         ▼                ▼
┌─────────┐  ┌─────────┐  ┌──────────────────┐
│ Tool    │  │ Tool    │  │ Tool Executor    │
│ Catalog │  │ Catalog │  │ (validates +     │
│         │  │         │  │  dispatches)     │
└─────────┘  └─────────┘  └──────────────────┘
```

---

## 3. The Three Meta-Tools

### 3.1 `list_tools`

**Purpose:** Discover available tools (short summaries only).

**Schema:**

```json
{
  "name": "list_tools",
  "description": "List available tools or search for tools by keyword. Returns short summaries only. Use get_tool_schema to get the full parameter schema before calling a tool.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Optional natural-language search query. Matches names, aliases, descriptions, tags, and parameter documentation."
      },
      "page": {
        "type": "integer",
        "minimum": 1,
        "description": "1-indexed page number. Results are always returned 10 per page."
      }
    },
    "additionalProperties": false
  }
}
```

**Behavior:**

| Call                         | Result                                      |
|------------------------------|---------------------------------------------|
| `list_tools()`               | First page of all tools the session can see |
| `list_tools(query="edit")`  | First page of ranked matching tools         |
| `list_tools(page=2)`         | Second page, 10 tools                       |

**Response format (short summaries):**

```json
{
  "page": 1,
  "pageSize": 10,
  "query": "edit",
  "totalMatches": 2,
  "totalPages": 1,
  "hasMore": false,
  "results": [
    {
      "id": "edit_file",
      "name": "edit_file",
      "description": "Edit a file by replacing exact text",
      "tags": ["filesystem", "coding"]
    },
    {
      "id": "read_file",
      "name": "read_file",
      "description": "Read the contents of a file",
      "tags": ["filesystem"]
    }
  ]
}
```

---

### 3.2 `get_tool_schema`

**Purpose:** Retrieve the complete JSON schema for one tool or a bounded batch of independent tools.

**Schema:**

```json
{
  "name": "get_tool_schema",
  "description": "Get the full parameter schema for a specific tool. Always call this before using execute_tool so you know the exact arguments required.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "Exact tool ID returned by list_tools"
      },
      "ids": {
        "type": "array",
        "description": "Exact tool IDs returned by list_tools; fetch up to 20 schemas in one call",
        "items": { "type": "string", "minLength": 1 },
        "minItems": 1,
        "maxItems": 20
      }
    },
    "oneOf": [
      { "required": ["id"] },
      { "required": ["ids"] }
    ],
    "additionalProperties": false
  }
}
```

Use `id` for a single schema to preserve the compact response format. Use
`ids` when several selected tools are independent. The batch response keeps
the requested order and includes an item-level error for an unknown or
disallowed ID, so one missing tool does not hide successful schemas.

**Response format (full schema):**

The response includes the complete parameter schema plus tool-specific
`guidance` that is fetched only after discovery:

```json
{
  "guidance": {
    "whenToUse": "Use for one precise replacement in an existing file.",
    "workflow": [
      "Read the current file first, then replace one exact target block."
    ],
    "safety": [
      "Keep the replacement target exact and verify the resulting file."
    ]
  }
}
```

```json
{
  "id": "edit_file",
  "name": "edit_file",
  "description": "Edit a file by replacing exact text",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path to the file"
      },
      "old_string": {
        "type": "string",
        "description": "Exact text to find"
      },
      "new_string": {
        "type": "string",
        "description": "Replacement text"
      }
    },
    "required": ["path", "old_string", "new_string"],
    "additionalProperties": false
  }
}
```

---

### 3.3 `execute_tool`

**Purpose:** Run a tool using its ID and arguments.

**Schema:**

```json
{
  "name": "execute_tool",
  "description": "Execute a tool by its ID. You must first obtain the tool's schema using get_tool_schema.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "Exact tool ID previously returned by list_tools"
      },
      "args": {
        "type": "object",
        "description": "Arguments that match the tool's schema. Use {} if the tool requires no parameters."
      }
    },
    "required": ["id", "args"],
    "additionalProperties": false
  }
}
```

**Behavior:**
1. Look up the tool by `id` in the current session’s allowed catalog
2. Validate `args` strictly against the tool’s JSON schema
3. If valid → execute the real tool and return its result
4. If invalid → return a clear, recoverable error

---

## 4. Tool Catalog Design

Every real tool is stored as:

```json
{
  "id": "edit_file",
  "name": "edit_file",
  "description": "Edit a file by replacing exact text",
  "tags": ["filesystem", "coding"],
  "parameters": { ... full JSON Schema ... },
  "handler": "<internal function reference>",
  "permissions": ["coding", "filesystem.write"],
  "version": "1.0.0"
}
```

- `id` is the stable unique key used by `get_tool_schema` and `execute_tool`
- In most cases `id` and `name` are the same
- `tags` power search in `list_tools`
- `permissions` control visibility per session/user

---

## 5. Typical Execution Flow

**User request:** “Change the print statement in main.py to say hello world”

**Model actions:**

```json
// 1. Discover relevant tools
{
  "name": "list_tools",
  "arguments": { "query": "edit file" }
}
```

→ receives short list containing `edit_file`

```json
// 2. Get the full schema
{
  "name": "get_tool_schema",
  "arguments": { "id": "edit_file" }
}
```

→ receives complete parameter schema

```json
// 3. Execute
{
  "name": "execute_tool",
  "arguments": {
    "id": "edit_file",
    "args": {
      "path": "main.py",
      "old_string": "print('hello')",
      "new_string": "print('hello world')"
    }
  }
}
```

→ tool runs and returns the result

---

## 6. Error Handling

Return structured, recoverable errors:

| Situation              | Error returned to model                                      |
|------------------------|--------------------------------------------------------------|
| Unknown tool ID        | `{ "error": "Tool 'xyz' not found or not allowed" }`         |
| Missing required arg   | `{ "error": "Missing required parameter: path", "schema": {...} }` |
| Wrong argument type    | `{ "error": "Parameter 'path' must be a string" }`           |
| Extra properties       | `{ "error": "Unexpected parameter: foo" }`                   |
| Execution failure      | `{ "error": "File not found: main.py" }`                     |

On validation errors, prefer returning the schema again so the model can self-correct without another `get_tool_schema` call.

---

## 7. Security & Permissions

- Every session has an **allowed tool set** (based on user role, conversation mode, etc.)
- `list_tools` only returns tools the session is allowed to see
- `get_tool_schema` and `execute_tool` both reject tools outside the allowed set
- High-risk tools can remain hidden until explicitly unlocked
- Optional: rate limiting or confirmation gates inside the executor for dangerous tools

---

## 8. Naming Rules

Tool names must be compatible with major providers:

- Allowed characters: `a-z A-Z 0-9 _ -`
- Maximum length: 64 characters
- **No dots** (rejected by OpenAI and Anthropic)

Chosen names:

- `list_tools`
- `get_tool_schema`
- `execute_tool`

---

## 9. System Prompt Guidance (recommended fragment)

```
You have only three tools: list_tools, get_tool_schema, and execute_tool.

- Always use list_tools first to discover available tools.
- Always use get_tool_schema to learn the exact parameters before calling a tool; use its `ids` form for independent tools.
- Never assume a tool’s arguments. Always fetch the schema.
- Then use execute_tool with the exact arguments required by the schema.
```

---

## 10. Comparison with Alternatives

| Approach                    | Strengths                              | Weaknesses                              |
|-----------------------------|----------------------------------------|-----------------------------------------|
| Static tool list            | Simple                                 | Context bloat, hard to scale            |
| Our design (3 meta-tools)   | Clear, reliable, scalable, debuggable  | Requires 2–3 round trips for first use  |
| Cloudflare Code Mode        | Extremely efficient for large APIs, supports complex orchestration in one turn | Requires code sandbox, less predictable, harder to debug |

Our design prioritizes **dependability and clarity** over maximum compression or single-turn orchestration.

---

## 11. Future Extensions (optional)

- Semantic search backend for `list_tools` (embeddings instead of keyword matching)
- `execute_tool(..., dry_run=true)` – validate without executing
- Tool versioning (`get_tool_schema(id, version)`)
- Result streaming for long-running tools
- Caching of schemas within a conversation turn

---

## 12. Summary

| Decision                  | Choice                                      |
|---------------------------|---------------------------------------------|
| Number of meta-tools      | **3**                                       |
| Discovery                 | `list_tools(query?)`                        |
| Schema inspection         | `get_tool_schema(id)` or `get_tool_schema(ids[])` |
| Execution                 | `execute_tool(id, args)`                    |
| Identifier                | Stable `id` (usually same as name)          |
| Naming style              | `snake_case` with underscores               |
| Schema style              | Strict JSON Schema + `additionalProperties: false` |
| Error style               | Structured + recoverable                    |
| Primary design goal       | Dependability and clarity                   |

This design keeps the classic, battle-tested tool-calling pattern while solving the “too many tools in context” problem cleanly and reliably.

---

## 13. Runtime implementation contract

The runtime exposes exactly these three provider-facing function tools:

```text
list_tools
get_tool_schema
execute_tool
```

Native workspace, terminal, Kanban, skill, provider, and MCP tools are built
privately, indexed into a per-request allowed catalog, and never passed to the
model as individual tool definitions. The catalog is rebuilt for the active
workspace and mode, so disabled MCP tools and plan-mode write tools cannot be
reached through a stale global registry.

`list_tools` uses a bounded relevance index. It normalizes case, punctuation,
diacritics, camelCase, singular/plural forms, common action synonyms, tool
aliases, tags, descriptions, and JSON-schema property documentation. Exact
name matches rank first, followed by prefix/substring matches, typo-tolerant
matches, phrase matches, and full-query coverage. Every response contains
`page`, `pageSize: 10`, `totalMatches`, `totalPages`, `hasMore`, and ranked
short summaries.

`execute_tool` validates the nested `args` object against the catalog entry's
actual JSON Schema on the backend before dispatch. Unknown tools, disabled
tools, provider-only tools, missing required properties, wrong primitive types,
unexpected properties, enum violations, and numeric/string/array constraints
produce structured recoverable errors. A successful nested execution keeps the
native tool's `status`, `summary`, `body`, `semantics`, `subject`, and result
presentation intact.

The model transcript continues to contain the outer `execute_tool` call and
result so providers only need to understand the three meta-tools. The display
projection is separate: the stream attaches the discovered native tool name and
native arguments to the UI invocation, and `toolInvocationPresentation.ts`
delegates to that native tool's existing presentation logic. Therefore the user
sees labels such as:

```text
Searched read in tool set
Listed tool set
Fetched schema for read
Read example.ts
Edited example.ts
Ran npm test
```

`execute_tool` is not shown for a successfully resolved native invocation, and
native structured result presentations such as file diffs, terminal output,
Kanban cards, and web results remain available to the existing UI components.

## 14. Prompt-cache contract

The provider-visible prompt contains one stable dynamic-tool protocol and the
three stable meta-tool definitions. The private native catalog is intentionally
excluded from `describeTools()` and from the system prompt, so adding, removing,
or reordering native catalog entries does not change the prompt-context
fingerprint. Tool-specific workflow guidance is returned only by
`get_tool_schema` after the model selects a tool. Independent selections can
share one bounded `get_tool_schema(ids[])` call; execution still remains
sequential wherever tools share mutable state.

The prompt fingerprint still changes when the actual system context changes,
such as the workspace root, workspace instructions, model/provider, or mode.
That is intentional: those contexts are behaviorally meaningful. Editing a
prompt file invalidates the old key once, then the new static prompt remains
stable and reusable.
