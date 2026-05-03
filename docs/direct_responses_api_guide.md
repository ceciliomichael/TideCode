# Codex Responses API: Complete Integration Guide (Single File)

Last verified: March 10, 2026

This is the canonical integration guide for this repository's Codex Responses backend usage.

It is intentionally focused on the internal Codex backend contract:

- `https://chatgpt.com/backend-api/codex/responses`
- `https://chatgpt.com/backend-api/codex/responses/compact`

It is not the same contract as public `https://api.openai.com/v1/responses`.

## 1. Integration Modes

Use one of these paths:

1. Direct Codex backend calls (this guide): strict Codex payload + Codex OAuth headers.
2. Local proxy compatibility mode: send OpenAI-style chat payloads to this repo's `/v1/chat/completions` or `/v1/responses`; proxy transforms upstream.

If your goal is maximum control and lowest translation ambiguity, use direct mode.

## 2. Endpoint Contract

- Streaming: `POST https://chatgpt.com/backend-api/codex/responses`
- Non-streaming compact: `POST https://chatgpt.com/backend-api/codex/responses/compact`

Headers:

- Streaming: `Accept: text/event-stream`
- Compact: `Accept: application/json`

## 3. Authentication (Codex OAuth)

Direct Codex backend calls require OAuth bearer tokens and account header.

### 3.1 OAuth constants

- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Scopes: `openid email profile offline_access`
- Query flags used by Codex flow:
  - `codex_cli_simplified_flow=true`
  - `id_token_add_organizations=true`

### 3.2 Token source is always user-profile auth file (`~/.echosphere/config/providers/codex/auth.json`)

Always load auth from the user profile Codex auth file:

- Unix/macOS: `~/.echosphere/config/providers/codex/auth.json`
- Windows: `%USERPROFILE%\\.echosphere\\config\\providers\\codex\\auth.json`

Do not hardcode tokens in source code or config when using this integration pattern.

Expected shape:

```json
{
  "auth_mode": "oauth_web",
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "2026-03-10T00:00:00Z"
}
```

Read:

- `tokens.access_token`
- `tokens.refresh_token`
- `tokens.id_token`
- `tokens.account_id`

If `tokens.account_id` is missing, decode JWT payload from `tokens.id_token`.

### 3.3 Refresh flow

Refresh token request:

- `POST https://auth.openai.com/oauth/token`
- Form fields:
  - `client_id=app_EMoamEEZ73f0CkXaXp7hrann`
  - `grant_type=refresh_token`
  - `refresh_token=<refresh_token>`
  - `scope=openid profile email`

Persist refreshed tokens back to the same user-profile `auth.json` file.

## 4. Required Request Headers

For every direct request:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: text/event-stream
Version: 0.101.0
User-Agent: codex_cli_rs/0.101.0 (Windows; x86_64)
Originator: codex_cli_rs
Session_id: <uuid-v4>
Chatgpt-Account-Id: <account_id>
```

Notes:

- Use `Accept: application/json` for `/responses/compact`.
- Generate a fresh `Session_id` per request.
- `Chatgpt-Account-Id` must match the OAuth identity.

## 5. Request Payload Schema (Codex Contract)

## 5.1 Required core fields

- `model`
- `stream`
- `store`
- `instructions`
- `input`
- `reasoning`

Common working defaults:

- `parallel_tool_calls: true`
- `include: ["reasoning.encrypted_content"]`

## 5.2 Message/content mapping

State is represented via transformed `input` items.

Mapping:

- `system` + `developer` prompts -> merged text into `instructions`
- `user` turns -> `content[].type = "input_text"`
- `assistant` turns -> `content[].type = "output_text"`
- user images (if used) -> `content[].type = "input_image"`

Minimal shape:

```json
{
  "instructions": "You are a helpful coding assistant.",
  "input": [
    {
      "role": "user",
      "content": [{ "type": "input_text", "text": "Hello" }]
    },
    {
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "Hi" }]
    }
  ]
}
```

## 5.3 Recommended reasoning block

```json
"reasoning": {
  "effort": "medium",
  "summary": "auto"
}
```

Typical effort values in this repo flow: `low`, `medium`, `high`, `xhigh`.

## 5.4 Full streaming example (tools + reasoning)

```json
{
  "model": "gpt-5.4",
  "stream": true,
  "store": false,
  "instructions": "You are a helpful coding assistant.",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "What time is it right now?" }
      ]
    }
  ],
  "parallel_tool_calls": true,
  "include": ["reasoning.encrypted_content"],
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  },
  "tools": [
    {
      "type": "function",
      "name": "get_current_time",
      "description": "Gets the current local time",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

## 5.5 Fields to avoid in direct Codex payloads

Avoid sending these in this backend flow:

- `temperature`
- `top_p`
- `top_k`
- `max_tokens`
- `max_completion_tokens`
- `previous_response_id`
- `conversation`
- `thread_id`
- `prompt_cache_retention`
- `safety_identifier`

## 6. Tools: Working Schema and Loop

## 6.1 Tool definition schema

Use flat function objects:

```json
{
  "type": "function",
  "name": "tool_name",
  "description": "What the tool does",
  "parameters": {
    "type": "object",
    "properties": {}
  }
}
```

Do not nest fields in a `function` object for this direct backend flow.

## 6.2 Tool-calling lifecycle

1. Send request with `tools`.
2. Read stream events until tool call appears.
3. Collect function-call metadata (`name`, `call_id`) and streamed arguments.
4. Execute tool in your application.
5. Send a follow-up request with updated `input` history.
6. Feed tool output back as new external input (in this repo's direct flow: new `user` `input_text` item).
7. Continue until final answer is produced.

Tool-result text format commonly used in this repo:

```text
Tool Result for <tool_name>:
<tool_output>
```

Important distinction:

- Public Responses API typically expects typed `function_call_output` items.
- This direct internal Codex flow in this repo currently uses a reliable user-text reinjection pattern.

## 7. State, History, and `thread_id`

For this direct Codex backend flow, maintain history client-side and resend transformed turns.

- No documented direct `conversation` state object contract.
- No documented direct `previous_response_id` chaining contract.
- `thread_id` is not part of this backend request shape.

So the practical state model is:

1. Keep transcript locally.
2. Rebuild `instructions` + `input` every follow-up turn.
3. Append assistant output and tool results to local state.
4. Resubmit full relevant history.

## 8. Streaming Event Handling (SSE)

The stream format is `data: <json>` lines plus final `[DONE]` marker.

Primary event types to parse:

- `response.output_text.delta`
  - assistant answer text chunk (`delta`)
- `response.reasoning_summary_text.delta`
  - reasoning summary text chunk (`delta`)
- `response.output_item.added`
  - may contain `function_call` item
- `response.function_call_arguments.delta`
  - streamed function arguments (`delta`)
- `response.function_call_arguments.done`
  - arguments stream finished
- `response.completed`
  - turn completion; often includes usage metrics
- `[DONE]`
  - end-of-stream marker

Other lifecycle events may appear (`response.created`, `response.in_progress`, content-part markers).

## 9. Compact Non-Streaming Mode

To use compact mode:

- Endpoint: `/responses/compact`
- Set `stream: false`
- Header: `Accept: application/json`

Response parsing:

- Read `output[]`
- `type == "message"` -> extract `content[].type == "output_text"`
- `type == "function_call"` -> extract tool call metadata and arguments
- Read usage if present

## 10. Implementation Functions You Need

These are the minimum integration functions that matter in production:

1. `load_auth()`
   - always read user-profile `~/.echosphere/config/providers/codex/auth.json` and return access token + account ID
2. `refresh_access_token()`
   - call OAuth token endpoint with refresh token, then persist
3. `build_headers(stream: bool)`
   - produce required Codex headers + fresh `Session_id`
4. `build_codex_payload(messages, tools, model, effort)`
   - map system/developer into `instructions`, map turns into typed `input`
5. `send_streaming_request(payload)`
   - POST `/responses`, parse SSE line-by-line
6. `parse_event(event_json)`
   - handle text deltas, reasoning deltas, function call events, completion
7. `execute_tool(name, args)`
   - run local function/API and return serialized output
8. `continue_after_tool_result(history, tool_output)`
   - append result to history and resend follow-up request
9. `send_compact_request(payload)`
   - POST `/responses/compact` and parse JSON output
10. `retry_and_timeout_policy()`
   - bounded retries + request timeout + safe failure handling

## 11. Production Checklist

Use this before shipping:

- Auth:
  - auth is always loaded from user-profile `~/.echosphere/config/providers/codex/auth.json` (Windows: `%USERPROFILE%\\.echosphere\\config\\providers\\codex\\auth.json`)
  - token refresh is implemented
  - token file writes are atomic/safe
- Headers:
  - all required Codex headers sent
  - fresh `Session_id` per request
- Payload correctness:
  - `store: false` always included
  - `instructions` always present
  - system/developer mapped to `instructions`
  - user/assistant mapped to typed `input`
- Tools:
  - flat tool schema used
  - function call args assembled across deltas
  - tool failures are surfaced with clear fallback text
- Streaming:
  - handles `[DONE]`
  - handles partial lines and JSON decode failures defensively
  - parses both answer and reasoning streams
- State:
  - local history persisted as needed
  - tool outputs appended before follow-up turn
- Observability:
  - request IDs/session IDs logged
  - upstream status/body captured for debugging (with token redaction)

## 12. Troubleshooting

### `access_token not found in auth.json`

Cause: reading wrong path. Tokens are under `tokens.*`.

### `Store must be set to false`

Cause: missing or incorrect `store` value.

Fix: include `"store": false`.

### `Missing required parameter: 'tools[0].name'`

Cause: wrong tool schema shape.

Fix: use flat tool object (`type`, `name`, `description`, `parameters`).

### Stream returns but no assistant text

Cause: parsing wrong event key.

Fix: read `response.output_text.delta` and its `delta` value.

### Reasoning not visible

Cause: reasoning events ignored.

Fix: parse `response.reasoning_summary_text.delta` separately.

## 13. Minimal cURL Examples

Streaming:

```bash
curl -sS https://chatgpt.com/backend-api/codex/responses \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Version: 0.101.0" \
  -H "User-Agent: codex_cli_rs/0.101.0 (Windows; x86_64)" \
  -H "Originator: codex_cli_rs" \
  -H "Session_id: $(uuidgen)" \
  -H "Chatgpt-Account-Id: $ACCOUNT_ID" \
  --data '{
    "model":"gpt-5.4",
    "stream":true,
    "store":false,
    "instructions":"You are a helpful coding assistant.",
    "input":[{"role":"user","content":[{"type":"input_text","text":"Hello"}]}],
    "reasoning":{"effort":"medium","summary":"auto"},
    "include":["reasoning.encrypted_content"],
    "parallel_tool_calls":true
  }'
```

Compact:

```bash
curl -sS https://chatgpt.com/backend-api/codex/responses/compact \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Version: 0.101.0" \
  -H "User-Agent: codex_cli_rs/0.101.0 (Windows; x86_64)" \
  -H "Originator: codex_cli_rs" \
  -H "Session_id: $(uuidgen)" \
  -H "Chatgpt-Account-Id: $ACCOUNT_ID" \
  --data '{
    "model":"gpt-5.4",
    "stream":false,
    "store":false,
    "instructions":"You are a helpful coding assistant.",
    "input":[{"role":"user","content":[{"type":"input_text","text":"Say hi"}]}],
    "reasoning":{"effort":"medium","summary":"auto"},
    "include":["reasoning.encrypted_content"],
    "parallel_tool_calls":true
  }'
```

## 14. Source References

Official public API references used for boundary checks and terminology:

- https://platform.openai.com/docs/api-reference/responses/create
- https://platform.openai.com/docs/guides/conversation-state
- https://platform.openai.com/docs/guides/function-calling
- https://platform.openai.com/docs/guides/migrate-to-responses

Repository implementation references aligned with this guide:

- `internal/proxy/upstream.go`
- `internal/proxy/transform.go`
- `internal/proxy/handler.go`
- `internal/auth/auth.go`
- `chat.py`
