import assert from 'node:assert/strict'
import test from 'node:test'
import { persistPlanImplementationHandoff } from '../src/lib/planHandoff'

test('successful plan handoff closes all workspace tabs for the plan path', async () => {
  const calls: string[] = []
  const relativePath = '.tidecode/plans/plan-001.md'

  const didHandoff = await persistPlanImplementationHandoff(relativePath, {
    handleCloseWorkspaceTabsByPath: (path) => calls.push(`close:${path}`),
    handleToggleExplorerPanel: () => calls.push('close:explorer'),
    handleMarkWorkspacePlanImplementationStarted: async (path) => {
      calls.push(`mark:${path}`)
      return true
    },
    isExplorerOpen: true,
  })

  assert.equal(didHandoff, true)
  assert.deepEqual(calls, [`mark:${relativePath}`, `close:${relativePath}`, 'close:explorer'])
})

test('failed plan handoff keeps workspace tabs open', async () => {
  const closeCalls: string[] = []
  const relativePath = '.tidecode/plans/plan-001.md'

  const didHandoff = await persistPlanImplementationHandoff(relativePath, {
    handleCloseWorkspaceTabsByPath: (path) => closeCalls.push(path),
    handleToggleExplorerPanel: () => closeCalls.push('explorer'),
    handleMarkWorkspacePlanImplementationStarted: async () => false,
    isExplorerOpen: true,
  })

  assert.equal(didHandoff, false)
  assert.deepEqual(closeCalls, [])
})

test('a handoff status write error keeps workspace tabs open', async () => {
  const closeCalls: string[] = []
  const relativePath = '.tidecode/plans/plan-001.md'
  const error = new Error('Plan file could not be read')

  await assert.rejects(
    persistPlanImplementationHandoff(relativePath, {
      handleCloseWorkspaceTabsByPath: (path) => closeCalls.push(path),
      handleToggleExplorerPanel: () => closeCalls.push('explorer'),
      handleMarkWorkspacePlanImplementationStarted: async () => {
        throw error
      },
      isExplorerOpen: true,
    }),
    error,
  )
  assert.deepEqual(closeCalls, [])
})

test('successful plan handoff does not toggle an already closed explorer panel', async () => {
  const calls: string[] = []
  const relativePath = '.tidecode/plans/plan-001.md'

  await persistPlanImplementationHandoff(relativePath, {
    handleCloseWorkspaceTabsByPath: (path) => calls.push(`close:${path}`),
    handleToggleExplorerPanel: () => calls.push('toggle:explorer'),
    handleMarkWorkspacePlanImplementationStarted: async () => true,
    isExplorerOpen: false,
  })

  assert.deepEqual(calls, [`close:${relativePath}`])
})
