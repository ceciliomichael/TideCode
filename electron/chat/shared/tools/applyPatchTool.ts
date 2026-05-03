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

const APPLY_PATCH_TOOL_DESCRIPTION = `Edit existing files with a structured patch using the apply_patch tool.
Your patch language is a stripped-down, file-oriented diff format designed to be easy to parse and safe to apply.

A patch starts with:
*** Begin Patch

and ends with:
*** End Patch

Within that envelope, include one or more file operations:
*** Add File: <path> - create a new file. Every following content line must start with +.
*** Delete File: <path> - remove an existing file. Nothing follows.
*** Update File: <path> - patch an existing file in place.

An update may be immediately followed by:
*** Move to: <new path>

Update hunks start with @@, optionally followed by a context header. Hunk body lines must start with a space, -, or +.
Use enough exact surrounding context from the latest read so the patch can be applied unambiguously. Order update hunks from top to bottom as they appear in each file.

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

Important:
- Include a file operation header for every changed file.
- Prefix new lines with + even when creating a file.
- For sandbox mode, use workspace-relative file paths like \`src/app.ts\`.
- Use \`write\` only when you need to replace a whole file.
- Do not use guessed paths; read or search first.
- always patch against the file as it exists right now on disk.
- grep results are only location hints.`

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
      description: 'Use the apply_patch tool to edit files. This is a freeform tool, so provide only the patch text, not JSON.',
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
