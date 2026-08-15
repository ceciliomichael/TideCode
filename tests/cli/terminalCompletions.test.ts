import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TerminalCompletionCatalog } from '../../electron/cli/terminalCompletions'

test('completion catalog derives slash commands from the command registry', () => {
  const catalog = new TerminalCompletionCatalog()
  const items = catalog.getItems('/res', 4)

  assert.equal(items[0]?.value, '/resume')
  assert.match(items[0]?.description ?? '', /session/i)

  const effortItems = catalog.getItems('/eff', 4)
  assert.equal(effortItems[0]?.value, '/effort')
  assert.match(effortItems[0]?.description ?? '', /reasoning effort/i)
})

test('completion catalog discovers workspace mentions and skips dependency folders', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-completions-'))
  try {
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
    await fs.mkdir(path.join(workspace, 'node_modules', 'ignored'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'src', 'composer.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspace, 'node_modules', 'ignored', 'package.ts'), 'export {}\n')

    const catalog = new TerminalCompletionCatalog()
    await catalog.preloadWorkspace(workspace)
    const items = catalog.getItems('please inspect @comp', 'please inspect @comp'.length)

    assert.deepEqual(items.map((item) => item.value), ['@src/composer.ts'])
    assert.equal(catalog.getItems('@package', '@package'.length).length, 0)
  } finally {
    await fs.rm(workspace, { force: true, recursive: true })
  }
})
