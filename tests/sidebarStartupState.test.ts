import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSidebarHistoryEmptyState } from '../src/components/sidebar/sidebarProjectThreads'

test('sidebar history never reports no projects while history is unresolved', () => {
  assert.equal(
    resolveSidebarHistoryEmptyState({
      hasProjects: false,
      isLoading: true,
      searchQuery: '',
      selectedProjectId: 'project-two',
    }),
    'loading',
  )
})

test('resolved empty project reports the project-specific empty state', () => {
  assert.equal(
    resolveSidebarHistoryEmptyState({
      hasProjects: true,
      isLoading: false,
      searchQuery: '',
      selectedProjectId: 'project-two',
    }),
    'no-threads',
  )
})
