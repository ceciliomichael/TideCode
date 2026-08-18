import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBootConversationLaunchState } from '../src/pages/chatInterface/chatLaunchState'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'

test('launch state restores a new chat directly into the saved project', () => {
  const launchState = resolveBootConversationLaunchState({
    ...DEFAULT_APP_SETTINGS,
    lastActiveConversationId: null,
    lastActiveDraftFolderId: 'project-one',
    openEmptyConversationOnLaunch: true,
    selectedProjectId: 'project-one',
    selectedProjectName: 'Project One',
  })

  assert.deepEqual(launchState, {
    preferredConversationId: null,
    preferredDraftFolderId: 'project-one',
    preferredDraftFolderName: 'Project One',
    openEmptyConversationOnLaunch: true,
  })
})

test('launch state restores an existing chat without losing its project context', () => {
  const launchState = resolveBootConversationLaunchState({
    ...DEFAULT_APP_SETTINGS,
    lastActiveConversationId: 'conversation-one',
    lastActiveDraftFolderId: 'project-one',
    openEmptyConversationOnLaunch: false,
    selectedProjectId: 'project-one',
    selectedProjectName: 'Project One',
  })

  assert.equal(launchState.preferredConversationId, 'conversation-one')
  assert.equal(launchState.preferredDraftFolderId, 'project-one')
  assert.equal(launchState.preferredDraftFolderName, 'Project One')
  assert.equal(launchState.openEmptyConversationOnLaunch, false)
})

test('launch state does not treat special sidebar filters as project folders', () => {
  const launchState = resolveBootConversationLaunchState({
    ...DEFAULT_APP_SETTINGS,
    lastActiveDraftFolderId: null,
    selectedProjectId: 'all-projects',
    selectedProjectName: null,
  })

  assert.equal(launchState.preferredDraftFolderId, null)
  assert.equal(launchState.preferredDraftFolderName, null)
})
