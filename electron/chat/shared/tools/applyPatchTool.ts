import { openai } from '@ai-sdk/openai'
import { jsonSchema, tool } from 'ai'
import type { ChatProviderId } from '../../../../src/types/chat'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createApplyPatchToolResult } from './workspaceTools'
import type { WorkspaceToolContext } from './workspaceTools'

const APPLY_PATCH_LARK_GRAMMAR = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`

const APPLY_PATCH_TOOL_DESCRIPTION = `Edit files using a line-by-line patch format.
The patch must start with "*** Begin Patch" and end with "*** End Patch".

Operations within the envelope:
*** Add File: <path>
Prefix every content line with +
*** Delete File: <path>
Delete the file. No content lines follow.
*** Update File: <path>
Patch an existing file. Optionally followed by "*** Move to: <new path>" to rename.

Update hunks start with "@@" or "@@ <context>". Hunk body lines must start with:
" " (unchanged context)
"-" (remove line)
"+" (add line)
Order update hunks chronologically from top to bottom.

Example:
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.ts
@@ function greet()
-console.log("Hi")
+console.log("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch

In Sandbox mode, paths must be workspace-relative.`

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
          description: 'The complete patch text, starting with *** Begin Patch and ending with *** End Patch.',
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
