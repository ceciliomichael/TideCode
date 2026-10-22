import assert from 'node:assert/strict'
import test from 'node:test'
import { getAppError } from '../../src/lib/errors/errorCatalog'
import { resolveAppError } from '../../src/lib/errors/resolveAppError'
import { ERROR_TOAST_DURATION_MS } from '../../src/components/ui/appNotifications'

test('a project already registered is not described as an unavailable conversation', () => {
  const error = new Error(
    "Error invoking remote method 'history:pickFolder': Error: Folder already exists: C:\\Users\\Admin\\Projects\\demo",
  )
  const feedback = resolveAppError(error, 'project.add')
  assert.deepEqual(feedback, getAppError('project.alreadyAdded'))
  assert.equal(feedback.title, 'Folder already added')
  assert.match(feedback.message, /Select it from the sidebar/)
  assert.doesNotMatch(feedback.message, /C:\\|Error invoking/)
})

test('creating a duplicate filesystem folder is different from registering an existing project', () => {
  const error = Object.assign(new Error("EEXIST: file already exists, mkdir 'C:\\Users\\Admin\\Projects\\demo'"), {
    code: 'EEXIST',
  })
  const feedback = resolveAppError(error, 'folder.create')
  assert.equal(feedback.id, 'folder.nameExists')
  assert.equal(feedback.title, 'Folder already exists')
  assert.match(feedback.message, /demo/)
  assert.doesNotMatch(feedback.message, /C:\\|EEXIST/)
})

test('explorer duplicate file errors preserve the filename without exposing paths', () => {
  const feedback = resolveAppError(new Error('Entry already exists: src/logo.png'), 'file.create', {
    itemKind: 'file',
  })
  assert.equal(feedback.id, 'file.nameExists')
  assert.match(feedback.message, /“logo.png”/)
  assert.doesNotMatch(feedback.message, /src\//)
})

test('known filesystem problems have specific, actionable causes', () => {
  assert.equal(resolveAppError({ code: 'EACCES', message: 'permission denied' }, 'folder.create').id, 'filesystem.permissionDenied')
  assert.equal(resolveAppError({ code: 'ENOENT' }, 'file.open').id, 'filesystem.notFound')
  assert.equal(resolveAppError({ code: 'ENOSPC' }, 'file.create').id, 'filesystem.noSpace')
})

test('Git failure titles match the operation and partial success is not reported as a failed commit', () => {
  const rejected = resolveAppError(new Error('non-fast-forward'), 'git.push')
  assert.equal(rejected.id, 'git.pushRejected')
  assert.equal(rejected.title, 'Push rejected')

  const partial = resolveAppError(
    new Error('Committed successfully but failed to push: remote unavailable'),
    'git.commit',
  )
  assert.equal(partial.id, 'git.partialSuccess')
  assert.match(partial.message, /saved locally/)
})

test('authentication and connection errors reflect the affected service', () => {
  assert.equal(resolveAppError('unauthorized', 'github.signIn').id, 'github.authentication')
  assert.equal(resolveAppError('invalid api key', 'provider.connect').id, 'provider.authentication')
  assert.equal(resolveAppError('fetch failed', 'provider.connect').id, 'provider.connect')
  assert.equal(resolveAppError('net::ERR_CONNECTION_REFUSED', 'browser.pageLoad').id, 'network.websiteUnreachable')
  assert.equal(resolveAppError('fetch failed', 'git.push').id, 'git.network')
  assert.equal(resolveAppError('fetch failed', 'updates.check').id, 'updates.connection')
  assert.equal(resolveAppError('fetch failed', 'mcp.connect').id, 'mcp.connect')
})

test('unknown technical failures use the operation fallback, not an invented cause', () => {
  const feedback = resolveAppError(new Error('TypeError: Cannot read properties of undefined'), 'project.add')
  assert.equal(feedback.id, 'project.add')
  assert.equal(feedback.title, 'Could not add folder')
  assert.doesNotMatch(feedback.message, /TypeError|undefined/)
})

test('safe validation messages retain their meaning', () => {
  const feedback = resolveAppError('Folder name is required.', 'folder.create')
  assert.equal(feedback.message, 'Folder name is required.')
  assert.equal(feedback.title, 'Could not create folder')
})

test('temporary error notifications last exactly three seconds', () => {
  assert.equal(ERROR_TOAST_DURATION_MS, 3000)
})
