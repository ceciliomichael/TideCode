import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatStructuredToolResultContent,
  getToolResultModelContent,
  parseStructuredToolResultContent,
} from '../../src/lib/toolResultContent'
import type { Message } from '../../src/types/chat'
import { buildChatPrompt, buildChatSystemPrompt } from '../../electron/chat/shared/messages'
import { buildSkillToolDescription, buildSkillsSystemPromptBlock } from '../../electron/skills/service'

test('buildChatSystemPrompt loads the mode-specific prompt content', () => {
  const agentPrompt = buildChatSystemPrompt('agent', 'C:/repo')
  const planPrompt = buildChatSystemPrompt('plan', 'C:/repo')

  assert.match(agentPrompt, /You are the active builder/u)
  assert.match(agentPrompt, /model-facing tool surface contains three capability tools/u)
  assert.match(agentPrompt, /list_tools searches the private catalog/u)
  assert.equal((agentPrompt.match(/<tool_instructions>/gu) ?? []).length, 1)
  assert.match(agentPrompt, /Tool workflow for every request that needs a tool/u)
  assert.match(agentPrompt, /Call list_tools first/u)
  assert.doesNotMatch(agentPrompt, /\blist_dir\b/u)
  assert.match(agentPrompt, /execute_tool may be called directly/u)
  assert.match(agentPrompt, /wait for the requested schema/u)
  assert.match(agentPrompt, /ids array for multiple independent tools/u)
  assert.match(agentPrompt, /targeted natural-language task query/u)
  assert.match(agentPrompt, /Default to 1-3 short sentences or a brief bullet list/u)
  assert.doesNotMatch(agentPrompt, /caveman|authorization_override/iu)

  assert.match(planPrompt, /You are a senior engineer creating plans/u)
  assert.match(planPrompt, /You are a senior engineer creating plans/u)
  assert.match(planPrompt, /Start directly with a concise numbered plan/u)
  assert.match(planPrompt, /Stay under 300 words/u)
  assert.doesNotMatch(planPrompt, /caveman|authorization_override/iu)
})

test('tool result replay preserves oversized model content without truncation', () => {
  const body = `head\n${'x'.repeat(60_000)}\ntail`
  const structuredContent = formatStructuredToolResultContent(
    {
      schema: 'tidecode.tool_result/v1',
      status: 'success',
      summary: 'Read a large file',
      toolCallId: 'tool-call-large',
      toolName: 'read',
    },
    body,
  )

  const modelContent = getToolResultModelContent(structuredContent)
  const storedResult = parseStructuredToolResultContent(structuredContent)

  assert.equal(modelContent, body)
  assert.equal(storedResult.body, body)
})

test('buildChatPrompt preserves assistant tool calls and matching tool results', () => {
  const messages: Message[] = [
    {
      content: 'Inspect the file',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [
        {
          argumentsText: JSON.stringify({ path: 'C:/repo/src/example.ts' }),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'read',
        },
      ],
    },
    {
      content: formatStructuredToolResultContent(
        {
          arguments: {
            path: 'C:/repo/src/example.ts',
          },
          semantics: {
            line_count: 1,
            offset: 1,
            revision: 'sha256:test-revision',
          },
          schema: 'tidecode.tool_result/v1',
          status: 'success',
          subject: {
            kind: 'file',
            path: 'src/example.ts',
          },
          summary: 'Read src/example.ts',
          toolCallId: 'tool-call-1',
          toolName: 'read',
        },
        '1: export const value = 1;',
      ),
      id: 'tool-message-1',
      role: 'tool',
      timestamp: 4,
      toolCallId: 'tool-call-1',
    },
  ]

  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages,
    workspaceRootPath: 'C:/repo',
  })

  assert.equal(prompt.messages.length, 3)
  assert.match(prompt.system, /Workspace root: C:\/repo/u)

  const assistantMessage = prompt.messages[1]
  assert.equal(assistantMessage?.role, 'assistant')
  assert.ok(Array.isArray(assistantMessage?.content))
  assert.equal(assistantMessage?.content[0]?.type, 'tool-call')
  assert.deepEqual(assistantMessage?.content[0]?.input, {
    path: 'C:/repo/src/example.ts',
  })

  const toolMessage = prompt.messages[2]
  assert.equal(toolMessage?.role, 'tool')
  assert.ok(Array.isArray(toolMessage?.content))
  assert.equal(toolMessage?.content[0]?.type, 'tool-result')
  assert.deepEqual(toolMessage?.content[0]?.output, {
    type: 'text',
    value: 'File: src/example.ts\nRevision: sha256:test-revision\n\n1: export const value = 1;',
  })
})

test('buildChatPrompt preserves image attachments in user messages', () => {
  const messages: Message[] = [
    {
      attachments: [
        {
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
          fileName: 'screenshot.png',
          id: 'attachment-1',
          kind: 'image',
          mimeType: 'image/png',
          sizeBytes: 32,
        },
      ],
      content: 'Please review this screenshot',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
  ]

  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages,
    workspaceRootPath: 'C:/repo',
  })

  assert.equal(prompt.messages.length, 1)
  const userMessage = prompt.messages[0]
  assert.equal(userMessage?.role, 'user')
  assert.ok(Array.isArray(userMessage?.content))
  assert.deepEqual(userMessage?.content[0], {
    text: 'Please review this screenshot',
    type: 'text',
  })
  assert.deepEqual(userMessage?.content[1], {
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    mediaType: 'image/png',
    type: 'image',
  })
})

test('buildChatPrompt preserves freeform apply_patch tool calls', () => {
  const patchText = `<patch>
<update path="src/example.ts">
@@
-const value = 1;
+const value = 2;
</update>
</patch>`
  const messages: Message[] = [
    {
      content: 'Edit the file',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [
        {
          argumentsText: patchText,
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'apply_patch',
        },
      ],
    },
    {
      content: formatStructuredToolResultContent(
        {
          schema: 'tidecode.tool_result/v1',
          semantics: {
            added_path_count: 0,
            deleted_path_count: 0,
            operation: 'edit',
            updated_path_count: 1,
          },
          status: 'success',
          subject: {
            kind: 'file',
            path: 'src/example.ts',
          },
          summary: 'Patched example.ts',
          toolCallId: 'tool-call-1',
          toolName: 'apply_patch',
        },
        'Patched example.ts\nM src/example.ts',
      ),
      id: 'tool-message-1',
      role: 'tool',
      timestamp: 4,
      toolCallId: 'tool-call-1',
    },
  ]

  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages,
    workspaceRootPath: 'C:/repo',
  })

  const assistantMessage = prompt.messages[1]
  assert.equal(assistantMessage?.role, 'assistant')
  assert.ok(Array.isArray(assistantMessage?.content))
  assert.equal(assistantMessage?.content[0]?.type, 'tool-call')
  assert.equal(assistantMessage?.content[0]?.input, patchText)
})

test('buildChatSystemPrompt includes enabled skill metadata when provided', () => {
  const prompt = buildChatSystemPrompt('agent', 'C:/repo', {
    availableSkillsBlock: buildSkillsSystemPromptBlock([
      {
        baseDirectory: 'C:/skills/docx',
        description: 'Work with Word documents.',
        id: 'C:/skills/docx/SKILL.md',
        location: 'C:/skills/docx/SKILL.md',
        name: 'docx',
        source: 'global',
        sourceLabel: 'Global',
      },
    ]),
  })

  assert.match(prompt, /<available_skills>/u)
  assert.match(prompt, /<name>docx<\/name>/u)
  assert.match(prompt, /Work with Word documents\./u)
})

test('buildSkillToolDescription states only the literal skill operation', () => {
  const description = buildSkillToolDescription([
    {
      baseDirectory: 'C:/skills/docx',
      description: 'Work with Word documents.',
      id: 'C:/skills/docx/SKILL.md',
      location: 'C:/skills/docx/SKILL.md',
      name: 'docx',
      source: 'global',
      sourceLabel: 'Global',
    },
  ])

  assert.match(description, /Loads and returns the complete instructions and base directory/u)
  assert.match(description, /selected by exact name/u)
  assert.match(description, /Enabled names: docx/u)
  assert.doesNotMatch(description, /when|should|use this/iu)
})

test('buildChatPrompt formats list tool results with structured directory metadata', () => {
  const messages: Message[] = [
    {
      content: 'Inspect the workspace',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [
        {
          argumentsText: JSON.stringify({ path: 'C:/repo/src' }),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'list',
        },
      ],
    },
    {
      content: formatStructuredToolResultContent(
        {
          arguments: {
            path: 'C:/repo/src',
          },
          schema: 'tidecode.tool_result/v1',
          semantics: {
            count: 2,
          },
          status: 'success',
          subject: {
            kind: 'directory',
            path: 'src',
          },
          summary: 'Listed src',
          toolCallId: 'tool-call-1',
          toolName: 'list',
        },
        'components/\nlib/',
      ),
      id: 'tool-message-1',
      role: 'tool',
      timestamp: 4,
      toolCallId: 'tool-call-1',
    },
  ]

  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages,
    workspaceRootPath: 'C:/repo',
  })

  const toolMessage = prompt.messages[2]
  assert.equal(toolMessage?.role, 'tool')
  assert.ok(Array.isArray(toolMessage?.content))
  assert.deepEqual(toolMessage?.content[0]?.output, {
    type: 'text',
    value: 'Directory: src\nEntries: 2\n\ncomponents/\nlib/',
  })
})

test('buildChatPrompt combines consecutive tool messages into one replay message', () => {
  const messages: Message[] = [
    {
      content: 'Inspect the files',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [
        {
          argumentsText: JSON.stringify({ path: 'C:/repo/src/one.ts' }),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'read',
        },
        {
          argumentsText: JSON.stringify({ path: 'C:/repo/src/two.ts' }),
          completedAt: 4,
          id: 'tool-call-2',
          resultContent: '',
          startedAt: 3,
          state: 'completed',
          toolName: 'read',
        },
        {
          argumentsText: JSON.stringify({ pattern: 'export' }),
          completedAt: 5,
          id: 'tool-call-3',
          resultContent: '',
          startedAt: 4,
          state: 'completed',
          toolName: 'grep',
        },
      ],
    },
    {
      content: formatStructuredToolResultContent(
        {
          arguments: {
            path: 'C:/repo/src/one.ts',
          },
          schema: 'tidecode.tool_result/v1',
          status: 'success',
          subject: {
            kind: 'file',
            path: 'src/one.ts',
          },
          summary: 'Read src/one.ts',
          toolCallId: 'tool-call-1',
          toolName: 'read',
        },
        '1: export const one = 1;',
      ),
      id: 'tool-message-1',
      role: 'tool',
      timestamp: 4,
      toolCallId: 'tool-call-1',
    },
    {
      content: formatStructuredToolResultContent(
        {
          arguments: {
            path: 'C:/repo/src/two.ts',
          },
          schema: 'tidecode.tool_result/v1',
          status: 'success',
          subject: {
            kind: 'file',
            path: 'src/two.ts',
          },
          summary: 'Read src/two.ts',
          toolCallId: 'tool-call-2',
          toolName: 'read',
        },
        '1: export const two = 2;',
      ),
      id: 'tool-message-2',
      role: 'tool',
      timestamp: 5,
      toolCallId: 'tool-call-2',
    },
    {
      content: formatStructuredToolResultContent(
        {
          arguments: {
            pattern: 'export',
          },
          schema: 'tidecode.tool_result/v1',
          status: 'success',
          subject: {
            kind: 'file',
            path: 'src/three.ts',
          },
          summary: 'Grep found exports',
          toolCallId: 'tool-call-3',
          toolName: 'grep',
        },
        'src/one.ts:1: export const one = 1;\nsrc/two.ts:1: export const two = 2;',
      ),
      id: 'tool-message-3',
      role: 'tool',
      timestamp: 6,
      toolCallId: 'tool-call-3',
    },
  ]

  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages,
    workspaceRootPath: 'C:/repo',
  })

  assert.equal(prompt.messages.length, 3)
  const combinedToolMessage = prompt.messages[2]
  assert.equal(combinedToolMessage?.role, 'tool')
  assert.ok(Array.isArray(combinedToolMessage?.content))
  assert.equal(combinedToolMessage?.content.length, 3)
})
