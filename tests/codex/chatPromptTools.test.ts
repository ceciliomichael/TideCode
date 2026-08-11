import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatStructuredToolResultContent,
  getToolResultModelContent,
  parseStructuredToolResultContent,
} from '../../src/lib/toolResultContent'
import type { Message } from '../../src/types/chat'
import { buildChatPrompt, buildChatSystemPrompt } from '../../electron/chat/shared/messages'
import { buildSkillToolDescription } from '../../electron/skills/service'

test('buildChatSystemPrompt loads the mode-specific prompt content', () => {
  const agentPrompt = buildChatSystemPrompt('agent', 'C:/repo')
  const planPrompt = buildChatSystemPrompt('plan', 'C:/repo')

  assert.match(agentPrompt, /You are the active builder/u)
  assert.match(agentPrompt, /Use the exact tool and schema for the task/u)
  assert.equal((agentPrompt.match(/<agent_tooling_instructions>/gu) ?? []).length, 1)
  assert.equal((agentPrompt.match(/<tool_instructions>/gu) ?? []).length, 0)
  assert.match(agentPrompt, /Read before editing/u)
  assert.match(agentPrompt, /Coordinate same-file mutations/u)
  assert.doesNotMatch(agentPrompt, /\blist_dir\b/u)
  assert.match(agentPrompt, /Answer first with the smallest complete response/u)
  assert.match(agentPrompt, /Native filesystem and plan targets always use the JSON key `path`/u)
  assert.doesNotMatch(agentPrompt, /caveman|authorization_override/iu)

  assert.match(planPrompt, /You are a senior software architect and rigorous planning interviewer/u)
  assert.match(planPrompt, /Ask exactly one focused question per response/u)
  assert.match(planPrompt, /Create one complete, self-contained Markdown plan/u)
  assert.match(planPrompt, /After saving, say only that the plan is visible in preview/u)
  assert.match(planPrompt, /Native filesystem and plan targets always use the JSON key `path`/u)
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

test('Codex fallback prompts do not synthesize unsupported generic reasoning parts', () => {
  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages: [
      {
        content: 'Inspect the file',
        id: 'user-1',
        role: 'user',
        timestamp: 1,
      },
      {
        content: 'The answer',
        id: 'assistant-1',
        reasoningContent: 'Inspecting the repository first.',
        role: 'assistant',
        timestamp: 2,
      },
    ],
    options: { includeAssistantReasoningParts: false },
    workspaceRootPath: 'C:/repo',
  })

  assert.deepEqual(prompt.messages[1], {
    content: 'The answer',
    role: 'assistant',
  })
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
  assert.equal('result' in (toolMessage?.content[0] ?? {}), false)
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
    text: 'Please review this screenshot [Image #1]',
    type: 'text',
  })
  assert.deepEqual(userMessage?.content[1], {
    data: {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      type: 'data',
    },
    filename: 'screenshot.png',
    mediaType: 'image/png',
    type: 'file',
  })
})

test('buildChatPrompt interleaves numbered images where the user referenced them', () => {
  const attachments = ['first', 'second'].map((id) => ({
    dataUrl: `data:image/png;base64,${id}`,
    fileName: `${id}.png`,
    id,
    kind: 'image' as const,
    mimeType: 'image/png',
    sizeBytes: 10,
  }))
  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages: [{
      attachments,
      content: 'Compare [Image #2] with [Image #1].',
      id: 'user-images',
      role: 'user',
      timestamp: 1,
    }],
    workspaceRootPath: 'C:/repo',
  })

  const content = prompt.messages[0]?.content
  assert.ok(Array.isArray(content))
  assert.deepEqual(content.slice(0, 5), [
    { text: 'Compare [Image #2]', type: 'text' },
    {
      data: { data: 'second', type: 'data' },
      filename: 'second.png',
      mediaType: 'image/png',
      type: 'file',
    },
    { text: ' with [Image #1]', type: 'text' },
    {
      data: { data: 'first', type: 'data' },
      filename: 'first.png',
      mediaType: 'image/png',
      type: 'file',
    },
    { text: '.', type: 'text' },
  ])
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

test('buildChatSystemPrompt does not expose skill metadata', () => {
  const prompt = buildChatSystemPrompt('agent', 'C:/repo')

  assert.doesNotMatch(prompt, /<available_skills>|<names>|skill/iu)
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

  assert.equal(description, 'List, search, or load an enabled skill.')
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
