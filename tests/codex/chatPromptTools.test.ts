import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatStructuredToolResultContent,
  getToolResultModelContent,
  parseStructuredToolResultContent,
} from '../../src/lib/toolResultContent'
import type { Message } from '../../src/types/chat'
import { buildChatPrompt, buildChatSystemPrompt } from '../../electron/chat/shared/messages'
import {
  isUnsupportedImageInputError,
  supportsModelImageInput,
} from '../../electron/chat/shared/modelImageSupport'
import { buildSkillToolDescription } from '../../electron/skills/service'
import {
  buildChatModeHiddenContext,
  buildExecutionModeHiddenContext,
  buildHiddenUserContextTransitions,
  buildRuntimeEnvironmentHiddenContextTransitions,
} from '../../src/lib/hiddenUserContext'

function createPromptImageAttachment() {
  return {
    dataUrl: 'data:image/png;base64,c2FtcGxl',
    fileName: 'screenshot.png',
    id: 'image-1',
    kind: 'image' as const,
    mimeType: 'image/png',
    sizeBytes: 6,
  }
}

test('buildChatSystemPrompt is mode-neutral', () => {
  const agentPrompt = buildChatSystemPrompt('agent', 'C:/repo')
  const planPrompt = buildChatSystemPrompt('plan', 'C:/repo')

  assert.equal(planPrompt, agentPrompt)
  assert.match(agentPrompt, /<decision_priority/u)
  assert.match(agentPrompt, /Answer first\. Report only the outcome/u)
  assert.match(agentPrompt, /<workspace_root authoritative="true"/u)
  assert.doesNotMatch(agentPrompt, /Agent Mode|Plan Mode|<chat_mode_context|plan_create|agent_tooling_instructions|<intent_rules/iu)
})

test('buildChatPrompt replays persisted hidden user context exactly without synthesizing mode state', () => {
  const planContext = buildChatModeHiddenContext('plan')
  const executionContext = buildExecutionModeHiddenContext('sandbox')
  const sourceMessage: Message = {
    chatMode: 'plan',
    content: 'Plan the change.',
    hiddenUserContext: [planContext, executionContext],
    id: 'user-plan',
    role: 'user',
    timestamp: 1,
  }
  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages: [sourceMessage],
    workspaceRootPath: 'C:/repo',
  })
  const plainPrompt = buildChatPrompt({
    chatMode: 'plan',
    messages: [{ content: 'No persisted context.', id: 'plain', role: 'user', timestamp: 1 }],
    workspaceRootPath: 'C:/repo',
  })

  assert.equal(sourceMessage.content, 'Plan the change.')
  assert.equal(prompt.messages[0]?.role, 'user')
  assert.equal(
    prompt.messages[0]?.content,
    ['Plan the change.', planContext.content, executionContext.content].join('\n\n'),
  )
  assert.equal(plainPrompt.messages[0]?.content, 'No persisted context.')
  assert.doesNotMatch(JSON.stringify(plainPrompt.messages), /<chat_mode_context|<execution_mode_context/u)
})

test('Plan to Agent transition keeps the previous provider messages as an exact prefix', () => {
  const planContext = buildChatModeHiddenContext('plan')
  const executionContext = buildExecutionModeHiddenContext('sandbox')
  const planMessages: Message[] = [
    {
      chatMode: 'plan',
      content: 'Plan the change.',
      hiddenUserContext: [planContext, executionContext],
      id: 'user-plan',
      role: 'user',
      timestamp: 1,
    },
    {
      content: 'The plan is ready for approval.',
      id: 'assistant-plan',
      role: 'assistant',
      timestamp: 2,
    },
  ]
  const planPrompt = buildChatPrompt({
    chatMode: 'plan',
    messages: planMessages,
    workspaceRootPath: 'C:/repo',
  })
  const agentTransitions = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: planMessages,
    terminalExecutionMode: 'sandbox',
  })
  assert.equal(agentTransitions.length, 1)
  assert.equal(agentTransitions[0]?.kind, 'chat_mode')
  assert.equal(agentTransitions[0]?.state, 'agent')

  const agentMessages: Message[] = [
    ...planMessages,
    {
      chatMode: 'agent',
      content: 'Implement the approved plan.',
      hiddenUserContext: agentTransitions,
      id: 'user-agent',
      role: 'user',
      timestamp: 3,
    },
  ]
  const agentPrompt = buildChatPrompt({
    chatMode: 'agent',
    messages: agentMessages,
    workspaceRootPath: 'C:/repo',
  })

  assert.deepEqual(agentPrompt.messages.slice(0, planPrompt.messages.length), planPrompt.messages)
  const lastMessageContent = String(agentPrompt.messages.at(-1)?.content ?? '')
  assert.ok(lastMessageContent.includes('mode="agent" state="active_until_superseded"'))
  assert.equal(lastMessageContent.includes('mode="sandbox"'), false)
})

test('runtime environment transition keeps the previous provider messages as an exact prefix', () => {
  const initialEnvironment = {
    pythonVenv: { name: '.venv', relativePath: '.venv' },
    terminalShell: { command: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', label: 'PowerShell' },
  }
  const initialContexts = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: initialEnvironment,
    messages: [],
  })
  const initialMessages: Message[] = [
    {
      chatMode: 'agent',
      content: 'Inspect the project.',
      hiddenUserContext: initialContexts,
      id: 'user-environment-initial',
      role: 'user',
      timestamp: 1,
    },
    {
      content: 'Inspection complete.',
      id: 'assistant-environment-initial',
      role: 'assistant',
      timestamp: 2,
    },
  ]
  const initialPrompt = buildChatPrompt({
    chatMode: 'agent',
    messages: initialMessages,
    workspaceRootPath: 'C:/repo',
  })
  const changedContexts = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: { ...initialEnvironment, pythonVenv: null },
    messages: initialMessages,
  })
  assert.deepEqual(changedContexts.map((context) => [context.kind, context.state]), [
    ['python_venv', 'none'],
  ])

  const changedMessages: Message[] = [
    ...initialMessages,
    {
      chatMode: 'agent',
      content: 'Continue without the virtual environment.',
      hiddenUserContext: changedContexts,
      id: 'user-environment-changed',
      role: 'user',
      timestamp: 3,
    },
  ]
  const changedPrompt = buildChatPrompt({
    chatMode: 'agent',
    messages: changedMessages,
    workspaceRootPath: 'C:/repo',
  })

  assert.deepEqual(changedPrompt.messages.slice(0, initialPrompt.messages.length), initialPrompt.messages)
  assert.match(String(changedPrompt.messages.at(-1)?.content ?? ''), /No Python virtual environment is currently detected/u)
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

test('legacy Code Mode undefined output replays the completed nested tool result', () => {
  const structuredContent = formatStructuredToolResultContent(
    {
      schema: 'tidecode.tool_result/v1',
      semantics: {
        tool_calls: [{
          body: 'Successfully wrote 1 file change\nA hello.py (+1 -0)',
          name: 'write',
          status: 'success',
          summary: 'Successfully wrote 1 file change',
        }],
      },
      status: 'success',
      summary: 'Code Mode completed with 1 tool call.',
      toolCallId: 'code-mode-legacy-1',
      toolName: 'code_mode',
    },
    'Code Mode completed with 1 tool call.\n\nundefined',
  )

  const modelContent = getToolResultModelContent(structuredContent)

  assert.doesNotMatch(modelContent, /undefined/u)
  assert.match(modelContent, /completed tool calls but returned no explicit value/u)
  assert.match(modelContent, /Successfully wrote 1 file change/u)
  assert.match(modelContent, /A hello\.py \(\+1 -0\)/u)
})

test('provider replay bounds oversized legacy tool content without mutating stored history', () => {
  const body = Array.from({ length: 4_000 }, (_value, index) => `line ${index} ${'x'.repeat(80)}`).join('\n')
  const storedToolResult = formatStructuredToolResultContent({
    arguments: { path: 'src/app.ts' },
    schema: 'tidecode.tool_result/v1',
    status: 'success',
    summary: 'Read a large file',
    toolCallId: 'tool-call-1',
    toolName: 'read',
  }, body)
  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages: [
      { content: 'Inspect the output.', id: 'user-1', role: 'user', timestamp: 1 },
      {
        content: '',
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 2,
        toolInvocations: [{
          argumentsText: JSON.stringify({ path: 'src/app.ts' }),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'read',
        }],
      },
      {
        content: storedToolResult,
        id: 'tool-1',
        role: 'tool',
        timestamp: 4,
        toolCallId: 'tool-call-1',
      },
    ],
    workspaceRootPath: 'C:/repo',
  })

  const toolMessage = prompt.messages.find((message) => message.role === 'tool')
  const output = toolMessage && Array.isArray(toolMessage.content)
    ? toolMessage.content[0]
    : null
  assert.ok(output && output.type === 'tool-result')
  assert.equal(typeof output.output.value, 'string')
  assert.ok(Buffer.byteLength(output.output.value, 'utf8') < 40_000)
  assert.match(output.output.value, /line 0 /u)
  assert.match(output.output.value, /line 3999 /u)
  assert.match(output.output.value, /Tool output truncated/u)
  assert.doesNotMatch(output.output.value, /read_tool_output/u)
  assert.equal(parseStructuredToolResultContent(storedToolResult).body, body)
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
  assert.match(prompt.system, /<workspace_root authoritative="true" type="absolute">\nC:\/repo\n<\/workspace_root>/u)

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

test('buildChatPrompt preserves raw-string Code Mode calls for history replay', () => {
  const source = "const result = await tools.read({ path: 'src/example.ts' }); return result"
  const messages: Message[] = [
    { content: 'Inspect the file', id: 'user-code-mode', role: 'user', timestamp: 1 },
    {
      content: '',
      id: 'assistant-code-mode',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [{
        argumentsText: JSON.stringify(source),
        completedAt: 3,
        id: 'code-mode-call',
        resultContent: '',
        startedAt: 2,
        state: 'completed',
        toolName: 'code_mode',
      }],
    },
    {
      content: formatStructuredToolResultContent({
        arguments: source,
        schema: 'tidecode.tool_result/v1',
        status: 'success',
        summary: 'Code Mode completed with 1 tool call.',
        toolCallId: 'code-mode-call',
        toolName: 'code_mode',
      }, 'Code Mode completed'),
      id: 'tool-code-mode',
      role: 'tool',
      timestamp: 4,
      toolCallId: 'code-mode-call',
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
  assert.equal(assistantMessage?.content[0]?.input, source)

  const toolMessage = prompt.messages[2]
  assert.equal(toolMessage?.role, 'tool')
  assert.ok(Array.isArray(toolMessage?.content))
  assert.equal(toolMessage?.content[0]?.toolName, 'code_mode')
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

test('buildChatPrompt preserves structured edit tool calls', () => {
  const editInput = {
    edits: [{
      endLine: 1,
      replacementContent: 'const value = 2;',
      startLine: 1,
      targetContent: 'const value = 1;',
    }],
    path: 'src/example.ts',
  }
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
          argumentsText: JSON.stringify(editInput),
          completedAt: 3,
          id: 'tool-call-1',
          resultContent: '',
          startedAt: 2,
          state: 'completed',
          toolName: 'edit',
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
          summary: 'Edited example.ts',
          toolCallId: 'tool-call-1',
          toolName: 'edit',
        },
        'Edited example.ts\nM src/example.ts',
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
  assert.deepEqual(assistantMessage?.content[0]?.input, editInput)
})

test('buildChatSystemPrompt does not expose skill metadata', () => {
  const prompt = buildChatSystemPrompt('agent', 'C:/repo')

  assert.doesNotMatch(prompt, /<available_skills>|<names>|skill/iu)
})

test('text-only models retain the raw image reference without an image content part', () => {
  const prompt = buildChatPrompt({
    chatMode: 'agent',
    messages: [{
      attachments: [createPromptImageAttachment()],
      content: 'Review this [Image #1]',
      id: 'user-image-1',
      role: 'user',
      timestamp: 1,
    }],
    options: { includeImageAttachments: false },
    workspaceRootPath: 'C:/repo',
  })

  const userMessage = prompt.messages[0]
  assert.equal(userMessage?.role, 'user')
  assert.equal(typeof userMessage?.content, 'string')
  assert.match(String(userMessage?.content), /Review this \[Image #1\]/u)
  assert.doesNotMatch(String(userMessage?.content), /data:image\/png/u)
})

test('DeepSeek enables image prompts only for the vision catalog model', () => {
  assert.equal(supportsModelImageInput('deepseek', 'deepseek-v4-flash-vision-exp'), true)
  assert.equal(supportsModelImageInput('deepseek', 'deepseek-v4-flash'), false)
  assert.equal(supportsModelImageInput('deepseek', 'deepseek-v4-pro'), false)
  assert.equal(supportsModelImageInput('deepseek', 'unlisted-deepseek-model'), false)
})

test('unsupported image API errors are recognized for text-only fallback', () => {
  assert.equal(isUnsupportedImageInputError(new Error(
    'Failed to deserialize messages[1]: unknown variant `image_url`, expected `text`',
  )), true)
  assert.equal(isUnsupportedImageInputError(new Error('Invalid API key')), false)
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
    value: 'Directory: src\nEntries: 2 of 2\n\ncomponents/\nlib/',
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
