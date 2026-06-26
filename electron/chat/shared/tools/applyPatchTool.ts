import { openai } from '@ai-sdk/openai'
import { jsonSchema, tool } from 'ai'
import type { ChatProviderId } from '../../../../src/types/chat'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createApplyPatchToolResult } from './workspaceTools'
import type { WorkspaceToolContext } from './workspaceTools'

const APPLY_PATCH_LARK_GRAMMAR = String.raw`start: patch_start hunk+ patch_end
patch_start: "<patch>" LF
patch_end: "</patch>" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "<add path=\"" filename "\">" LF add_line+ "</add>" LF
delete_hunk: "<delete path=\"" filename "\" />" LF
update_hunk: "<update path=\"" filename "\"" move_attr? ">" LF change? "</update>" LF

move_attr: " move_to=\"" filename "\""
filename: /[^"]+/
add_line: "+" /(.*)/ LF -> line

change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "<end_of_file />" LF

%import common.LF
`

const APPLY_PATCH_TOOL_DESCRIPTION = `Edit files using a line-by-line patch format.
The patch must start with "<patch>" and end with "</patch>".

Operations within the envelope:
<add path="path/to/file">
Prefix every content line with +
</add>

<delete path="path/to/file" />

<update path="path/to/file" move_to="optional/new/path">
Patch an existing file. Optionally use move_to to rename.
Update hunks start with "@@" or "@@ <context>" or "@@ -<start_line>,<count> +<new_start>,<count> @@". Hunk body lines must start with:
" " (unchanged context)
"-" (remove line)
"+" (add line)
Order update hunks chronologically from top to bottom.
</update>

Example:
<patch>
<add path="hello.txt">
+Hello world
</add>
<update path="src/app.ts">
@@ function greet()
-console.log("Hi")
+console.log("Hello, world!")
</update>
<delete path="obsolete.txt" />
</patch>

In Sandbox mode, paths must be workspace-relative.

Important:
- Context and deletion lines in a hunk must match the target file exactly and contiguously. Do not skip or omit any intermediate lines.
- Your patch MUST actually contain changes. Do not output hunks that only contain unchanged " " context lines, and do not replace a line with the exact same line.
- For rewriting most of a file or large-scale replacements, use the "write" tool instead of "apply_patch".`

function createToolErrorResult(summary: string): AgentToolExecutionResult {
  return {
    status: 'error',
    summary,
  }
}

async function executeApplyPatch(context: WorkspaceToolContext, patchText: string) {
  try {
    return await createApplyPatchToolResult(context, patchText)
  } catch (error) {
    return createToolErrorResult(
      error instanceof Error && error.message.trim().length > 0 ? error.message : 'Patch failed.',
    )
  }
}

export function createApplyPatchTool(context: WorkspaceToolContext, providerId: ChatProviderId | undefined) {
  if (providerId === 'codex') {
    return openai.tools.customTool({
      name: 'apply_patch',
      description: 'Use the apply_patch tool to edit files. This is a freeform tool, so provide only the patch text, not JSON. The latest read is the source of truth; patch only exact current text. Successful text edits are written with LF line endings.',
      format: {
        definition: APPLY_PATCH_LARK_GRAMMAR,
        syntax: 'lark',
        type: 'grammar',
      },
      execute: async (patchText) => executeApplyPatch(context, patchText),
    })
  }

  return tool({
    description: APPLY_PATCH_TOOL_DESCRIPTION,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        patchText: {
          description: 'The complete patch text, starting with <patch> and ending with </patch>.',
          minLength: 1,
          type: 'string',
        },
      },
      required: ['patchText'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const inputValue = rawInput as { patchText: string }
      return executeApplyPatch(context, inputValue.patchText)
    },
  })
}
