import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TerminalCompletionCatalog } from '../../electron/cli/terminalCompletions'
import type { CliSessionState } from '../../electron/cli/types'

test('completion catalog derives slash commands from the command registry', () => {
  const catalog = new TerminalCompletionCatalog()
  const items = catalog.getItems('/res', 4)

  assert.equal(items[0]?.value, '/resume')
  assert.match(items[0]?.description ?? '', /session/i)

  const effortItems = catalog.getItems('/eff', 4)
  assert.equal(effortItems.length, 0)
})

test('completion catalog hides compact while the current thread is below the compaction message minimum', () => {
  const catalog = new TerminalCompletionCatalog()
  const state: CliSessionState = {
    activeStreamId: null,
    chatMode: 'agent',
    compactionLocked: true,
    conversationId: 'conversation-1',
    isStreaming: false,
    messages: [
      { content: 'Prompt', id: 'user-1', role: 'user', timestamp: 1 },
      { content: 'Answer', id: 'assistant-1', role: 'assistant', timestamp: 2 },
    ],
    modelId: 'gpt-test',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }

  assert.equal(catalog.getItems('/comp', 5, state).some((item) => item.value === '/compact'), false)
  state.compactionLocked = false
  state.messages.push({ content: 'Next prompt', id: 'user-2', role: 'user', timestamp: 3 })
  assert.equal(catalog.getItems('/comp', 5, state).some((item) => item.value === '/compact'), true)
})

test('completion catalog matches desktop workspace visibility and supports files, folders, and skills', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-completions-'))
  try {
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
    await fs.mkdir(path.join(workspace, 'ignored'), { recursive: true })
    await fs.mkdir(path.join(workspace, 'node_modules', 'ignored'), { recursive: true })
    await fs.mkdir(path.join(workspace, 'skills', 'review'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.gitignore'), 'ignored/\n*.secret\n')
    await fs.writeFile(path.join(workspace, 'src', 'composer.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspace, 'src', 'componentMap.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspace, 'ignored', 'should-not-appear.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspace, 'hidden.secret'), 'secret\n')
    await fs.writeFile(path.join(workspace, 'node_modules', 'ignored', 'package.ts'), 'export {}\n')
    await fs.writeFile(
      path.join(workspace, 'skills', 'review', 'SKILL.md'),
      ['---', 'name: code-review', 'description: Reviews code carefully.', '---', '', '# Review', '', 'Check the diff.'].join('\n'),
    )

    const catalog = new TerminalCompletionCatalog()
    await catalog.preloadWorkspace(workspace)

    const fileItems = catalog.getItems('please inspect @comp', 'please inspect @comp'.length)
    assert.equal(fileItems[0]?.value, '@composer.ts')
    assert.equal(fileItems[0]?.mentionKind, 'file')
    assert.equal(fileItems[0]?.mentionPath, 'read_file:src/composer.ts')
    assert.match(fileItems[0]?.description ?? '', /src\/composer\.ts/)

    const folderItems = catalog.getItems('@src', '@src'.length)
    assert.equal(folderItems[0]?.value, '@src')
    assert.equal(folderItems[0]?.mentionKind, 'folder')
    assert.equal(folderItems[0]?.mentionPath, 'list:src')

    const skillItems = catalog.getItems('@code-rev', '@code-rev'.length)
    assert.equal(skillItems[0]?.value, '@code-review')
    assert.equal(skillItems[0]?.mentionKind, 'skill')
    assert.equal(skillItems[0]?.mentionPath, 'load_skill:code-review')
    assert.match(skillItems[0]?.description ?? '', /Reviews code carefully/)

    assert.equal(catalog.getItems('@should-not', '@should-not'.length).length, 0)
    assert.equal(catalog.getItems('@hidden', '@hidden'.length).length, 0)
    assert.equal(catalog.getItems('@package', '@package'.length).length, 0)
  } finally {
    await fs.rm(workspace, { force: true, recursive: true })
  }
})
