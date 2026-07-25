import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFallbackKanbanTaskPlan,
  parseKanbanTaskPlanResponse,
} from '../../electron/kanban/planner'

test('parses and bounds a structured AI task plan', () => {
  const plan = parseKanbanTaskPlanResponse(`
    Here is the plan:
    {
      "description": "Build a reliable task flow.",
      "acceptanceCriteria": ["Creation is atomic", "Creation is atomic", "Errors are visible"],
      "subtasks": ["Define contracts", "Build the composer", "Add tests"],
      "labels": ["kanban", "ai", "kanban"]
    }
  `)

  assert.equal(plan.description, 'Build a reliable task flow.')
  assert.deepEqual(plan.acceptanceCriteria, [
    'Creation is atomic',
    'Errors are visible',
  ])
  assert.deepEqual(plan.subtasks, [
    'Define contracts',
    'Build the composer',
    'Add tests',
  ])
  assert.deepEqual(plan.labels, ['kanban', 'ai'])
})

test('rejects invalid or empty AI task plans', () => {
  assert.throws(
    () => parseKanbanTaskPlanResponse('not json'),
    /valid task plan/u,
  )
  assert.throws(
    () =>
      parseKanbanTaskPlanResponse(
        JSON.stringify({
          acceptanceCriteria: [],
          description: '',
          labels: [],
          subtasks: [],
        }),
      ),
    /empty task plan/u,
  )
})

test('builds an editable local task plan when model output is unusable', () => {
  const plan = buildFallbackKanbanTaskPlan({
    description: 'Keep the existing product constraints.',
    title: 'Make AI planning reliable',
    workspacePath: 'C:\\workspace',
  })

  assert.equal(plan.description, 'Keep the existing product constraints.')
  assert.equal(plan.acceptanceCriteria.length, 3)
  assert.equal(plan.subtasks.length, 5)
  assert.deepEqual(plan.labels, [])
  assert.match(plan.acceptanceCriteria[0], /Make AI planning reliable/u)
})
