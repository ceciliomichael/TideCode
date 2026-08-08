import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNativeAgentTools } from '../../electron/chat/shared/tools'
import { createPlan, editPlan } from '../../electron/plans/service'
import { getPlanDisplayContent, getPlanLineRange, getPlanStatus, setPlanStatus } from '../../src/lib/planContracts'
import { createPlanImplementationMessage, parsePlanImplementationMessage } from '../../src/lib/planImplementation'
import { formatPlanReviewRequest } from '../../src/lib/planReview'
import {
  getLatestCompletedPlanPresentation,
  getPlanPathsCreatedByRevertedUserMessage,
  hasPlanToolInvocation,
} from '../../src/lib/planPresentation'

test('plan storage allocates incrementing numbered Markdown artifacts', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-plans-'))
  const capturedPaths: string[] = []

  try {
    const firstPlan = await createPlan({
      beforeMutation: async (absolutePath) => {
        capturedPaths.push(absolutePath)
      },
      content: '## Steps\n\n1. Inspect the current flow.\n',
      title: 'First plan',
      workspaceRootPath,
    })
    const secondPlan = await createPlan({
      content: '# Second plan\n\n1. Update the flow.\n',
      workspaceRootPath,
    })

    assert.equal(firstPlan.relativePath, '.tidecode/plans/plan-001.md')
    assert.equal(secondPlan.relativePath, '.tidecode/plans/plan-002.md')
    assert.equal(firstPlan.title, 'First plan')
    const storedFirstPlan = await fs.readFile(path.join(workspaceRootPath, '.tidecode', 'plans', 'plan-001.md'), 'utf8')
    assert.match(storedFirstPlan, /^---\nstatus: draft\n---\n/u)
    assert.equal(getPlanStatus(storedFirstPlan), 'draft')
    assert.match(storedFirstPlan, /# First plan\n\n## Steps/u)
    assert.deepEqual(capturedPaths, [path.join(workspaceRootPath, '.tidecode', 'plans', 'plan-001.md')])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('plan editing is limited to an existing numbered plan path', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-plan-edit-'))
  const capturedPaths: string[] = []

  try {
    await createPlan({ content: '# Reviewable plan\n\nOriginal.', workspaceRootPath })
    const updatedPlan = await editPlan({
      beforeMutation: async (absolutePath) => {
        capturedPaths.push(absolutePath)
      },
      content: '# Reviewable plan\n\nRevised.',
      relativePath: '.tidecode\\plans\\plan-001.md',
      workspaceRootPath,
    })

    assert.equal(updatedPlan.operation, 'updated')
    const storedUpdatedPlan = await fs.readFile(path.join(workspaceRootPath, '.tidecode', 'plans', 'plan-001.md'), 'utf8')
    assert.match(storedUpdatedPlan, /^---\nstatus: draft\n---\n/u)
    assert.match(storedUpdatedPlan, /# Reviewable plan\n\nRevised\./u)
    assert.deepEqual(capturedPaths, [path.join(workspaceRootPath, '.tidecode', 'plans', 'plan-001.md')])
    await assert.rejects(
      editPlan({ content: '# Unsafe', relativePath: '.tidecode/plans/../plan-001.md', workspaceRootPath }),
      /Plan paths must match/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('plan mode exposes plan tools while agent mode does not', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-plan-tool-set-'))

  try {
    const planTools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'plan' })
    const agentTools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'agent' })

    assert.ok('plan_create' in planTools)
    assert.ok('plan_edit' in planTools)
    assert.ok(!('plan_create' in agentTools))
    assert.ok(!('plan_edit' in agentTools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('plan tool execution returns a persisted plan presentation', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-plan-tool-execution-'))

  try {
    const planTools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'plan' })
    const createPlanTool = planTools.plan_create as unknown as {
      execute: (input: { content: string; title: string }) => Promise<{
        resultPresentation?: {
          content: string
          kind: string
          relativePath: string
        }
      }>
    }
    const result = await createPlanTool.execute({
      content: '## Steps\n\n1. Review the change.',
      title: 'Executable plan',
    })

    assert.equal(result.resultPresentation?.kind, 'plan')
    assert.equal(result.resultPresentation?.relativePath, '.tidecode/plans/plan-001.md')
    assert.equal(
      result.resultPresentation?.content,
      '---\nstatus: draft\n---\n\n# Executable plan\n\n## Steps\n\n1. Review the change.\n',
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('plan review utilities preserve source lines and actionable comments', () => {
  const content = '# Reviewable plan\n\n## Steps\n\n1. Inspect the current flow.\n2. Update the flow.\n'
  const lineRange = getPlanLineRange(content, '## Steps\n\n1. Inspect the current flow.')
  const collapsedLineRange = getPlanLineRange(content, '## Steps 1. Inspect the current flow.')

  assert.deepEqual(lineRange, { lineEnd: 5, lineStart: 3 })
  assert.deepEqual(collapsedLineRange, { lineEnd: 5, lineStart: 3 })

  const request = formatPlanReviewRequest('.tidecode/plans/plan-001.md', [
    {
      comment: 'Add a rollback step.',
      id: 'comment-1',
      lineEnd: 5,
      lineStart: 3,
      quote: '## Steps 1. Inspect the current flow.',
    },
  ])

  assert.match(request, /plan_edit/u)
  assert.match(request, /Lines 3–5/u)
  assert.match(request, /Add a rollback step/u)
})

test('plan tool detection includes running and completed plan invocations', () => {
  assert.equal(
    hasPlanToolInvocation([
      {
        content: '',
        id: 'assistant-plan',
        role: 'assistant',
        timestamp: Date.now(),
        toolInvocations: [
          {
            argumentsText: '{}',
            id: 'plan-call',
            startedAt: Date.now(),
            state: 'running',
            toolName: 'plan_create',
          },
        ],
      },
    ]),
    true,
  )
  assert.equal(
    hasPlanToolInvocation([
      {
        content: '',
        id: 'assistant-read',
        role: 'assistant',
        timestamp: Date.now(),
        toolInvocations: [
          {
            argumentsText: '{}',
            id: 'read-call',
            startedAt: Date.now(),
            state: 'completed',
            toolName: 'read',
          },
        ],
      },
    ]),
    false,
  )
})

test('final plan presentation uses the latest completed plan tool result', () => {
  const latestPlan = getLatestCompletedPlanPresentation([
    {
      content: '',
      id: 'assistant-plan-turn',
      role: 'assistant',
      timestamp: Date.now(),
      toolInvocations: [
        {
          argumentsText: '{}',
          id: 'plan-create-call',
          resultPresentation: {
            content: '# Original plan\n',
            fileName: 'plan-001.md',
            kind: 'plan',
            operation: 'created',
            planId: '001',
            relativePath: '.tidecode/plans/plan-001.md',
            title: 'Original plan',
            updatedAt: 1,
          },
          startedAt: Date.now(),
          state: 'completed',
          toolName: 'plan_create',
        },
        {
          argumentsText: '{}',
          id: 'plan-edit-call',
          resultPresentation: {
            content: '# Revised plan\n',
            fileName: 'plan-001.md',
            kind: 'plan',
            operation: 'updated',
            planId: '001',
            relativePath: '.tidecode/plans/plan-001.md',
            title: 'Revised plan',
            updatedAt: 2,
          },
          startedAt: Date.now(),
          state: 'completed',
          toolName: 'plan_edit',
        },
      ],
    },
  ])

  assert.equal(latestPlan?.title, 'Revised plan')
  assert.equal(latestPlan?.updatedAt, 2)
})

test('implementation requests use a six-digit tag that can be rendered as status', () => {
  const message = createPlanImplementationMessage('.tidecode/plans/plan-001.md')
  assert.match(message, /^<plan_\d{6}>Implement the plan in \.tidecode\/plans\/plan-001\.md\.<\/plan_\d{6}>$/u)
  assert.equal(parsePlanImplementationMessage(message)?.message, 'Implement the plan in .tidecode/plans/plan-001.md.')
})

test('plan status frontmatter survives implementation updates without entering the preview body', () => {
  const startedContent = setPlanStatus('# A plan\n\n## Steps\n\n1. Do it.\n', 'implementation_started')

  assert.equal(getPlanStatus(startedContent), 'implementation_started')
  assert.equal(getPlanDisplayContent(startedContent), '# A plan\n\n## Steps\n\n1. Do it.\n')
})

test('revert cleanup only selects plans created after the target user turn', () => {
  const paths = getPlanPathsCreatedByRevertedUserMessage(
    [
      {
        content: 'Keep this plan.',
        id: 'user-before',
        role: 'user',
        timestamp: 1,
      },
      {
        content: '',
        id: 'assistant-before',
        role: 'assistant',
        timestamp: 2,
        toolInvocations: [
          {
            argumentsText: '{}',
            id: 'plan-before',
            resultPresentation: {
              content: '# Existing plan',
              fileName: 'plan-001.md',
              kind: 'plan',
              operation: 'created',
              planId: '001',
              relativePath: '.tidecode/plans/plan-001.md',
              title: 'Existing plan',
              updatedAt: 1,
            },
            startedAt: 2,
            state: 'completed',
            toolName: 'plan_create',
          },
        ],
      },
      {
        content: 'Revert this turn.',
        id: 'user-target',
        role: 'user',
        timestamp: 3,
      },
      {
        content: '',
        id: 'assistant-target',
        role: 'assistant',
        timestamp: 4,
        toolInvocations: [
          {
            argumentsText: '{}',
            id: 'plan-target',
            resultPresentation: {
              content: '# New plan',
              fileName: 'plan-002.md',
              kind: 'plan',
              operation: 'created',
              planId: '002',
              relativePath: '.tidecode/plans/plan-002.md',
              title: 'New plan',
              updatedAt: 4,
            },
            startedAt: 4,
            state: 'completed',
            toolName: 'plan_create',
          },
        ],
      },
    ],
    'user-target',
  )

  assert.deepEqual(paths, ['.tidecode/plans/plan-002.md'])
})
