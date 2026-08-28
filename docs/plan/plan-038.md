# Split Context Indicator Static Tokens

## Goal
Show the system prompt and tool-schema portions separately while preserving the same total context calculation.

## Changes
- Add a `toolSchemaTokens` field to context-usage estimates and keep `systemPromptTokens` system-only.
- Populate both fields in preflight estimates and live/compaction usage events.
- Update fallback total calculations and reset/default values.
- Render separate System prompt and Tools rows in the context indicator, plus the combined total.

## Verification
- Update context-budget assertions for the separated fields and add UI/helper coverage where appropriate.
- Run affected tests, type checking, linting, and diff validation.

## Scope
- No change to token estimation or context budgeting; this separates existing values for accurate observability only.
