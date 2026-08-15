import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createWorkspaceDirectoryWatcher,
  resolveWorkspaceDirectoryWatchTargets,
} from '../../electron/workspace/explorerDirectoryWatcher'

const EVENT_TIMEOUT_MS = 4_000
const QUIET_WINDOW_MS = 300

async function waitForEventCount(readCount: () => number, expectedCount: number) {
  const startedAt = Date.now()
  while (readCount() < expectedCount) {
    if (Date.now() - startedAt >= EVENT_TIMEOUT_MS) {
      assert.fail(`Expected at least ${expectedCount} workspace watcher events, received ${readCount()}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('resolves only unique watch targets contained by the workspace', () => {
  const workspaceRootPath = path.resolve('workspace-root')

  assert.deepEqual(
    resolveWorkspaceDirectoryWatchTargets(
      workspaceRootPath,
      new Set(['.', 'src', 'src', path.join('..', 'outside')]),
    ).sort(),
    [workspaceRootPath, path.join(workspaceRootPath, 'src')].sort(),
  )
})

test('reports external changes in the root and expanded directories without traversing ignored trees', async (context) => {
  const workspaceRootPath = await mkdtemp(path.join(tmpdir(), 'tidecode-explorer-watch-'))
  const expandedDirectoryPath = path.join(workspaceRootPath, 'src')
  const ignoredDirectoryPath = path.join(workspaceRootPath, 'node_modules', 'dependency')
  await mkdir(expandedDirectoryPath, { recursive: true })
  await mkdir(ignoredDirectoryPath, { recursive: true })

  let eventCount = 0
  let watcherError: unknown = null
  const watcher = createWorkspaceDirectoryWatcher({
    rootPath: workspaceRootPath,
    watchedRelativeDirectoryPaths: new Set(['.', 'src']),
    onChange: () => {
      eventCount += 1
    },
    onError: (error) => {
      watcherError = error
    },
  })

  context.after(async () => {
    await watcher.close()
    await rm(workspaceRootPath, { force: true, recursive: true })
  })
  await watcher.ready

  await writeFile(path.join(workspaceRootPath, 'root-file.txt'), 'root')
  await waitForEventCount(() => eventCount, 1)

  const countAfterRootChange = eventCount
  await writeFile(path.join(expandedDirectoryPath, 'expanded-file.txt'), 'expanded')
  await waitForEventCount(() => eventCount, countAfterRootChange + 1)

  const countBeforeRename = eventCount
  await rename(
    path.join(expandedDirectoryPath, 'expanded-file.txt'),
    path.join(expandedDirectoryPath, 'expanded-renamed.txt'),
  )
  await waitForEventCount(() => eventCount, countBeforeRename + 1)

  const countBeforeDelete = eventCount
  await unlink(path.join(expandedDirectoryPath, 'expanded-renamed.txt'))
  await waitForEventCount(() => eventCount, countBeforeDelete + 1)

  const countBeforeDirectoryPaste = eventCount
  await mkdir(path.join(workspaceRootPath, 'pasted-folder'))
  await waitForEventCount(() => eventCount, countBeforeDirectoryPaste + 1)

  const countBeforeIgnoredChange = eventCount
  await writeFile(path.join(ignoredDirectoryPath, 'index.js'), 'ignored')
  await new Promise((resolve) => setTimeout(resolve, QUIET_WINDOW_MS))

  assert.equal(eventCount, countBeforeIgnoredChange)
  assert.equal(watcherError, null)
})

test('stops reporting changes after the watcher is closed', async (context) => {
  const workspaceRootPath = await mkdtemp(path.join(tmpdir(), 'tidecode-explorer-watch-close-'))
  context.after(async () => {
    await rm(workspaceRootPath, { force: true, recursive: true })
  })

  let eventCount = 0
  const watcher = createWorkspaceDirectoryWatcher({
    rootPath: workspaceRootPath,
    watchedRelativeDirectoryPaths: new Set(['.']),
    onChange: () => {
      eventCount += 1
    },
    onError: (error) => {
      assert.fail(`Workspace watcher failed: ${String(error)}`)
    },
  })
  await watcher.ready
  await watcher.close()

  await writeFile(path.join(workspaceRootPath, 'after-close.txt'), 'closed')
  await new Promise((resolve) => setTimeout(resolve, QUIET_WINDOW_MS))

  assert.equal(eventCount, 0)
})
