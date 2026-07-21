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
update_hunk: "*** Update File: " filename LF move_line? change?

move_line: "*** Move to: " filename LF
filename: /[^\n]+/
add_line: "+" /(.*)/ LF -> line

change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`

const APPLY_PATCH_TOOL_DESCRIPTION = `Applies one standard structured patch containing add, update, move, or delete operations. Input is raw patch text without a Markdown fence.

Format:
*** Begin Patch
*** Add File: path/to/new.txt
+Every added-file line starts with +
*** Update File: path/to/existing.ts
@@ optional unique function or class context
 unchanged context line
-exact line to remove
+replacement line
*** Delete File: path/to/obsolete.txt
*** End Patch

Execution:
- Paths may be workspace-relative. Sandbox mode rejects paths outside the workspace.
- Each update-body line starts with one space for context, - for removal, or + for addition.
- Context and removal lines match contiguous current source. Whitespace-only indentation drift is tolerated; ambiguous matches are rejected.
- @@ text anchors a hunk. Unified-diff line numbers are treated as hints when the source sequence has one unique shifted match.
- Files and hunks are processed top to bottom. Parsing and every hunk are validated before any file write.
- No-op patches return an error. Successful text writes use LF line endings.`

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
      description: APPLY_PATCH_TOOL_DESCRIPTION,
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
          description: 'The complete patch text, from *** Begin Patch through *** End Patch.',
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
