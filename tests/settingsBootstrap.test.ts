import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInitialSettingsArg, serializeInitialSettingsArg } from '../electron/settings/bootstrap'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'

test('parseInitialSettingsArg sanitizes persisted edit sessions by conversation', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      editSessionsByConversation: {
        ' conversation-a ': { messageId: ' message-a ' },
        '': { messageId: 'message-empty-conversation' },
        'conversation-b': { messageId: '' },
      },
      revertEditSessionsByConversation: {
        ' conversation-c ': { messageId: ' message-c ', redoCheckpointId: ' redo-c ' },
      },
    }),
  ])

  assert.deepEqual(parsedSettings.editSessionsByConversation, {
    'conversation-a': { messageId: 'message-a' },
  })
  assert.deepEqual(parsedSettings.revertEditSessionsByConversation, {
    'conversation-c': { messageId: 'message-c', redoCheckpointId: 'redo-c' },
  })
})

test('parseInitialSettingsArg resets launch-only terminal open state', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      terminalOpenByWorkspace: {
        '__global__': true,
        workspaceA: true,
      },
    }),
  ])

  assert.deepEqual(parsedSettings.terminalOpenByWorkspace, {})
})

test('parseInitialSettingsArg preserves empty chat launch preference', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      lastActiveConversationId: null,
      openEmptyConversationOnLaunch: true,
    }),
  ])

  assert.equal(parsedSettings.lastActiveConversationId, null)
  assert.equal(parsedSettings.openEmptyConversationOnLaunch, true)
})

test('parseInitialSettingsArg sanitizes disabled skill paths', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      disabledSkillsByPath: {
        ' C:/skills/docx/SKILL.md ': true,
        'C:/skills/imagegen/SKILL.md': false,
        '': true,
      },
    }),
  ])

  assert.deepEqual(parsedSettings.disabledSkillsByPath, {
    'C:/skills/docx/SKILL.md': true,
  })
})

test('parseInitialSettingsArg preserves AI task planning configuration', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      kanbanAiPlanningEnabled: true,
      kanbanModelId: 'gpt-5',
      kanbanModelLabel: 'GPT-5',
      kanbanModelProviderId: 'openai',
    }),
  ])

  assert.equal(parsedSettings.kanbanAiPlanningEnabled, true)
  assert.equal(parsedSettings.kanbanModelId, 'gpt-5')
  assert.equal(parsedSettings.kanbanModelLabel, 'GPT-5')
  assert.equal(parsedSettings.kanbanModelProviderId, 'openai')
})
