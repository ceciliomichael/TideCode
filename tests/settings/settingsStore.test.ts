import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { writeJsonFileAtomic } from '../../electron/settings/fileStore'
import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'

function buildLegacySettings() {
  const legacyDefaults: Partial<typeof DEFAULT_APP_SETTINGS> = { ...DEFAULT_APP_SETTINGS }
  delete legacyDefaults.agentReasoningEffort
  delete legacyDefaults.planReasoningEffort
  delete legacyDefaults.summarizationReasoningEffort
  delete legacyDefaults.gitCommitReasoningEffort
  delete legacyDefaults.kanbanReasoningEffort
  return {
    ...legacyDefaults,
    appearance: 'dark' as const,
    checkForUpdatesOnLaunch: false,
    chatModelId: 'legacy-model',
    chatModelProviderId: 'codex' as const,
    chatModelLabel: 'Legacy model',
    chatReasoningEffort: 'high' as const,
    language: 'fil-PH' as const,
    sendMessageOnEnter: false,
    modelToggleState: { 'codex:gpt-5.4': false },
    conversationModelPreferences: {
      'thread-agent': {
        chatMode: 'agent' as const,
        label: 'Legacy thread model',
        modelId: 'legacy-thread-model',
        providerId: 'codex' as const,
        reasoningEffort: 'high' as const,
      },
    },
  }
}

async function withSettingsHome(run: (input: { configDirectoryPath: string; tempHomePath: string }) => Promise<void>) {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-surface-settings-'))
  const configDirectoryPath = path.join(tempHomePath, '.tidecode', 'config')
  const previousSettingsHome = process.env.TIDECODE_SETTINGS_HOME
  try {
    process.env.TIDECODE_SETTINGS_HOME = tempHomePath
    await fs.mkdir(configDirectoryPath, { recursive: true })
    await run({ configDirectoryPath, tempHomePath })
  } finally {
    mock.restoreAll()
    if (previousSettingsHome === undefined) delete process.env.TIDECODE_SETTINGS_HOME
    else process.env.TIDECODE_SETTINGS_HOME = previousSettingsHome
    await fs.rm(tempHomePath, { force: true, recursive: true })
  }
}

test('writeJsonFileAtomic replaces an existing file without leaving a partial write behind', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-settings-atomic-'))
  const targetPath = path.join(tempRootPath, 'settings.json')
  const originalContent = JSON.stringify({ value: 'original' }, null, 2)
  const nextContent = JSON.stringify({ value: 'updated' }, null, 2)
  const originalRename = fs.rename.bind(fs)
  let shouldForceFallback = true

  try {
    await fs.writeFile(targetPath, originalContent, 'utf8')
    mock.method(fs, 'rename', async (source, destination) => {
      if (shouldForceFallback && String(destination) === targetPath) {
        shouldForceFallback = false
        const error = new Error('File exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      return originalRename(source, destination)
    })
    await writeJsonFileAtomic(targetPath, nextContent)
    assert.equal(await fs.readFile(targetPath, 'utf8'), nextContent)
    await assert.rejects(fs.access(targetPath + '.bak'), { code: 'ENOENT' })
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('legacy settings migrate into independent desktop, web, and cli surface files', async () => {
  await withSettingsHome(async ({ configDirectoryPath }) => {
    const legacySettings = buildLegacySettings()
    await fs.writeFile(path.join(configDirectoryPath, 'settings.json'), JSON.stringify(legacySettings, null, 2), 'utf8')
    await fs.writeFile(path.join(configDirectoryPath, 'workspace-ui-state.json'), JSON.stringify({
      ...legacySettings,
sidebarWidth: 360,
    }, null, 2), 'utf8')

    const { getStoredSettings } = await import('../../electron/settings/store')
    const [desktop, web, cli] = await Promise.all([
      getStoredSettings('desktop'),
      getStoredSettings('web'),
      getStoredSettings('cli'),
    ])

    for (const settings of [desktop, web, cli]) {
      assert.equal(settings.appearance, 'dark')
      assert.equal(settings.chatModelId, 'legacy-model')
      assert.equal(settings.chatReasoningEffort, 'high')
      assert.equal(settings.agentReasoningEffort, 'high')
      assert.equal(settings.planReasoningEffort, 'high')
      assert.equal(settings.summarizationReasoningEffort, 'high')
      assert.equal(settings.gitCommitReasoningEffort, 'high')
      assert.equal(settings.kanbanReasoningEffort, 'high')
assert.equal(settings.sidebarWidth, 360)
    }

    for (const surface of ['desktop', 'web', 'cli']) {
      await fs.access(path.join(configDirectoryPath, 'surface-settings.' + surface + '.json'))
    }

    const sharedFile = JSON.parse(await fs.readFile(path.join(configDirectoryPath, 'settings.json'), 'utf8')) as Record<string, unknown>
    assert.equal('appearance' in sharedFile, false)
    assert.equal('chatModelId' in sharedFile, false)
    assert.equal('conversationModelPreferences' in sharedFile, false)
    assert.deepEqual(sharedFile.modelToggleState, { 'codex:gpt-5.4': false })
  })
})

test('settings reads serialize in-process and recover an exited-owner lock', async () => {
  await withSettingsHome(async ({ configDirectoryPath }) => {
    await fs.writeFile(path.join(configDirectoryPath, 'settings.lock'), '2147483647\n', 'utf8')

    const { getStoredSettings } = await import('../../electron/settings/store')
    const [first, second, third] = await Promise.all([
      getStoredSettings('desktop'),
      getStoredSettings('desktop'),
      getStoredSettings('desktop'),
    ])

    assert.equal(first.chatModelId, DEFAULT_APP_SETTINGS.chatModelId)
    assert.equal(second.chatModelId, DEFAULT_APP_SETTINGS.chatModelId)
    assert.equal(third.chatModelId, DEFAULT_APP_SETTINGS.chatModelId)
    await assert.rejects(fs.access(path.join(configDirectoryPath, 'settings.lock')), { code: 'ENOENT' })
  })
})

test('desktop, web, and cli preferences diverge while shared settings converge', async () => {
  await withSettingsHome(async () => {
    const { getStoredSettings, updateStoredSettings } = await import('../../electron/settings/store')

    await updateStoredSettings({
      appearance: 'light',
      chatModelId: 'desktop-model',
      chatModelLabel: 'Desktop model',
      chatReasoningEffort: 'high',
      agentReasoningEffort: 'high',
    }, 'desktop')
    await updateStoredSettings({
      appearance: 'dark',
      chatModelId: 'web-model',
      chatModelLabel: 'Web model',
      chatReasoningEffort: 'medium',
      agentReasoningEffort: 'medium',
    }, 'web')
    await updateStoredSettings({
      agentModelId: 'cli-agent-model',
      agentModelLabel: 'CLI agent model',
      chatReasoningEffort: 'low',
      agentReasoningEffort: 'low',
    }, 'cli')

    await updateStoredSettings({
      modelToggleState: { 'codex:gpt-5.4': false },
      kanbanAiPlanningEnabled: false,
      gitCommitReasoningEffort: 'low',
    }, 'web')

    const desktop = await getStoredSettings('desktop')
    const web = await getStoredSettings('web')
    const cli = await getStoredSettings('cli')

    assert.equal(desktop.appearance, 'light')
    assert.equal(desktop.chatModelId, 'desktop-model')
    assert.equal(desktop.chatReasoningEffort, 'high')
    assert.equal(desktop.agentReasoningEffort, 'high')
    assert.equal(web.appearance, 'dark')
    assert.equal(web.chatModelId, 'web-model')
    assert.equal(web.chatReasoningEffort, 'medium')
    assert.equal(web.agentReasoningEffort, 'medium')
    assert.equal(cli.agentModelId, 'cli-agent-model')
    assert.equal(cli.chatReasoningEffort, 'low')
    assert.equal(cli.agentReasoningEffort, 'low')

    for (const settings of [desktop, web, cli]) {
      assert.deepEqual(settings.modelToggleState, { 'codex:gpt-5.4': false })
      assert.equal(settings.kanbanAiPlanningEnabled, false)
      assert.equal(settings.gitCommitReasoningEffort, 'low')
    }
  })
})

test('conversation model and reasoning preferences are isolated per surface', async () => {
  await withSettingsHome(async () => {
    const { getStoredSettings, updateStoredConversationModelPreference } = await import('../../electron/settings/store')

    await updateStoredConversationModelPreference('thread-1', {
      chatMode: 'agent',
      label: 'Desktop thread model',
      modelId: 'desktop-thread-model',
      providerId: 'codex',
      reasoningEffort: 'high',
    }, 'desktop')
    await updateStoredConversationModelPreference('thread-1', {
      chatMode: 'agent',
      label: 'Web thread model',
      modelId: 'web-thread-model',
      providerId: 'codex',
      reasoningEffort: 'medium',
    }, 'web')
    await updateStoredConversationModelPreference('thread-1', {
      chatMode: 'agent',
      label: 'CLI thread model',
      modelId: 'cli-thread-model',
      providerId: 'codex',
      reasoningEffort: 'low',
    }, 'cli')

    const desktop = await getStoredSettings('desktop')
    const web = await getStoredSettings('web')
    const cli = await getStoredSettings('cli')
    assert.equal(desktop.conversationModelPreferences['thread-1']?.modelId, 'desktop-thread-model')
    assert.equal(desktop.conversationModelPreferences['thread-1']?.reasoningEffort, 'high')
    assert.equal(web.conversationModelPreferences['thread-1']?.modelId, 'web-thread-model')
    assert.equal(web.conversationModelPreferences['thread-1']?.reasoningEffort, 'medium')
    assert.equal(cli.conversationModelPreferences['thread-1']?.modelId, 'cli-thread-model')
    assert.equal(cli.conversationModelPreferences['thread-1']?.reasoningEffort, 'low')
  })
})
