import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import type { Message } from '../../src/types/chat'
import { buildChatPrompt, buildChatSystemPrompt } from '../../electron/chat/shared/messages'
import { buildSkillToolDescription, buildSkillsSystemPromptBlock } from '../../electron/skills/service'

test('buildChatSystemPrompt loads the mode-specific prompt content', () => {
  const agentPrompt = buildChatSystemPrompt('agent', 'C:/repo')
  const planPrompt = buildChatSystemPrompt('plan', 'C:/repo')

  assert.match(agentPrompt, /You are Echo, a production-grade software engineering assistant/u)
  assert.match(agentPrompt, /## execution workflow/iu)
  assert.match(agentPrompt, /WHEN ADDING PACKAGES ALWAYS USE npm install to get latest/u)
  assert.match(agentPrompt, /## Markdown Output Rules/u)
  assert.match(agentPrompt, /<tooling_instructions description="Tool usage guidance"/u)
  assert.match(agentPrompt, /If MCP tools are available and relevant to the task, use them/u)
  assert.match(agentPrompt, /If the task arrived without a backlog card, create one before implementation\./u)
  assert.match(agentPrompt, /read_board/u)
  assert.match(agentPrompt, /move_card/u)
  assert.match(agentPrompt, /Read before edit: never change a file you have not inspected\./u)
  assert.match(agentPrompt, /`apply_patch`: use for small, targeted edits when you know the exact lines to change\./u)

  assert.match(planPrompt, /You are Echo, a production-grade software engineering planner/u)
  assert.match(planPrompt, /## planning workflow/iu)
  assert.match(planPrompt, /Do not implement\. Do not provide full code\./u)
  assert.match(planPrompt, /WHEN ADDING PACKAGES ALWAYS USE npm install to get latest/u)
  assert.match(planPrompt, /<tooling_instructions description="Tool usage guidance"/u)
  assert.match(planPrompt, /If MCP tools are available and relevant to the task, use them/u)
  assert.match(planPrompt, /In plan mode, Kanban setup must not block producing the plan/u)
  assert.match(planPrompt, /read_board/u)
  assert.match(planPrompt, /Prefer read-only tools first; avoid edit tools unless the task explicitly requires changing files\./u)
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
          argumentsText: JSON.stringify({ absolute_path: 'C:/repo/src/example.ts' }),
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
            absolute_path: 'C:/repo/src/example.ts',
          },
          semantics: {
            line_count: 1,
            offset: 1,
          },
          schema: 'echosphere.tool_result/v1',
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
    absolute_path: 'C:/repo/src/example.ts',
  })

  const toolMessage = prompt.messages[2]
  assert.equal(toolMessage?.role, 'tool')
  assert.ok(Array.isArray(toolMessage?.content))
  assert.equal(toolMessage?.content[0]?.type, 'tool-result')
  assert.deepEqual(toolMessage?.content[0]?.output, {
    type: 'text',
    value: 'Read result\nPath: src/example.ts\nAbsolute path: C:/repo/src/example.ts\nType: file\nLine count: 1\n\n1: export const value = 1;',
  })
})

test('buildChatPrompt preserves freeform apply_patch tool calls', () => {
  const patchText = `*** Begin Patch
*** Update File: src/example.ts
@@
-const value = 1;
+const value = 2;
*** End Patch`
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
          schema: 'echosphere.tool_result/v1',
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

test('buildSkillToolDescription uses strict skill-loading guidance', () => {
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

  assert.match(description, /Load one skill and read its full instructions\./u)
  assert.match(description, /Use this only when the current task clearly matches a listed skill\./u)
  assert.match(description, /Do not guess\./u)
  assert.match(description, /- docx: Work with Word documents\./u)
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
          argumentsText: JSON.stringify({ absolute_path: 'C:/repo/src' }),
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
            absolute_path: 'C:/repo/src',
          },
          schema: 'echosphere.tool_result/v1',
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
    value: 'List result\nAbsolute path: C:/repo/src\nRelative path: src\nType: directory\nEntry count: 2\n\ncomponents/\nlib/',
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
          argumentsText: JSON.stringify({ absolute_path: 'C:/repo/src/one.ts' }),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'read',
        },
        {
          argumentsText: JSON.stringify({ absolute_path: 'C:/repo/src/two.ts' }),
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
            absolute_path: 'C:/repo/src/one.ts',
          },
          schema: 'echosphere.tool_result/v1',
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
            absolute_path: 'C:/repo/src/two.ts',
          },
          schema: 'echosphere.tool_result/v1',
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
          schema: 'echosphere.tool_result/v1',
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
