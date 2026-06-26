# Patch Format Blueprint for AI Developers

This document explains the exact patch format currently accepted by the workspace editing tool, why the earlier edits failed, and how to add unified-diff offset support safely if desired.

## 1) Current format in this workspace

The editing tool expects a **freeform text patch**, not a JSON object. The tool call wrapper passes the patch as a plain string.

The patch must be wrapped like this:

```text
<patch>
<add path="path/to/new-file.txt">
+line 1
+line 2
</add>

<update path="path/to/existing-file.txt">
@@
- old line
+ new line
</update>

<delete path="path/to/file.txt" />
</patch>
```

### Supported operations

- `<add path="...">` — create a new file
- `<update path="...">` — edit an existing file
- `<delete path="..." />` — delete a file

## 2) Important detail: `@@` is content-based, not offset-based

In the current tool behavior, the `@@` line inside an `<update>` block is treated as a **context marker**, not a unified diff hunk header.

That means this works only when the content following `@@` matches the current file text exactly enough for the patch engine to locate it:

```text
<update path="src/components/Footer.tsx">
@@
-              The AI creative studio that turns ideas into stunning visual
-              work — instantly.
+              The AI creative studio that turns ideas into stunning visual work
+              — instantly.
</update>
```

## 3) What failed

I attempted to use unified-diff style offset syntax like this:

```text
@@ -29,32
```

That failed because the patch engine did **not** interpret `-29,32` as a valid instruction in the current implementation. It expected content-based context, not line-number-based hunk metadata.

## 4) Why the failure happened

The failure came from mixing two different patch models:

### A. Content-based patching
- Uses actual file text as context
- More robust across line shifts
- Current workspace behavior

### B. Unified diff patching
- Uses line offsets and hunk ranges
- Example: `@@ -29,7 +29,7 @@`
- Not currently supported by the tool parser

## 5) Recommended implementation direction if you want offset support

If you want the tool to accept unified diff offsets, the patch parser should be extended deliberately and explicitly.

### Suggested parser rules

Support both forms inside `<update>` blocks:

1. **Context mode**
   ```text
   @@
   - old
   + new
   ```

2. **Unified diff mode**
   ```text
   @@ -29,7 +29,7 @@
   - old
   + new
   ```

### Safety rules

If offset support is added, the parser should:
- validate the target file still matches the referenced hunk range before applying
- fail loudly if line counts or offsets do not line up
- avoid partial application when a hunk is ambiguous
- preserve existing content unless the hunk is fully validated

## 6) Why content-based matching is still safer

Even if offset support is added, content-based matching remains safer for most edits because:
- line numbers shift after earlier changes
- content-based failures are self-correcting
- offset-based mistakes can be harder to spot if validation is weak

## 7) Practical recommendation for your AI developer

If your goal is reliability, keep the current content-based format and treat unified-diff offsets as an optional enhancement only if the parser can fully validate them.

If your goal is convenience for power users, add offset support as a second accepted syntax, but keep strict validation and clear error messages.

## 8) Summary

- Current patch format: freeform `<patch>` text with `<add>`, `<update>`, and `<delete>` blocks
- Current `<update>` behavior: content-based matching
- Unified diff offsets: **not currently supported** in the tool behavior I used
- Safe enhancement path: add offset parsing with strict validation, not as a loose fallback
