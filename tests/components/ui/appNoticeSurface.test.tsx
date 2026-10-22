import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppNoticeSurface } from '../../../src/components/ui/AppNoticeSurface'
import { resolveAppError } from '../../../src/lib/errors/resolveAppError'

test('application errors use raised notification styling and hide technical failures', () => {
  const html = renderToStaticMarkup(createElement(AppNoticeSurface, {
    title: 'Could not save screenshot',
    message: 'SyntaxError: Unexpected token }',
    fallbackMessage: 'The screenshot could not be saved. Try again.',
    onDismiss: () => undefined,
  }))
  assert.match(html, /bg-surface-raised/)
  assert.match(html, /Could not save screenshot/)
  assert.match(html, /The screenshot could not be saved. Try again./)
  assert.match(html, /Dismiss notification/)
  assert.doesNotMatch(html, /SyntaxError|Unexpected token|bg-danger-surface/)
})

test('persistent errors and screenshot notices share the same surface', () => {
  const html = renderToStaticMarkup(createElement(AppNoticeSurface, {
    title: 'Screenshot saved',
    mode: 'toast',
    role: 'region',
    ariaLabel: 'Browser screenshot notification',
    dismissLabel: 'Dismiss screenshot notification',
    onDismiss: () => undefined,
  }))
  assert.match(html, /Browser screenshot notification/)
  assert.match(html, /Dismiss screenshot notification/)
  assert.match(html, /role="status"/)
  assert.match(html, /bg-surface-raised/)
})

test('notifications still explain errors without exception messages', () => {
  const html = renderToStaticMarkup(createElement(AppNoticeSurface, {
    title: 'Attachment unavailable',
    message: '',
    fallbackMessage: 'The attachment could not be added. Try again.',
  }))
  assert.match(html, /The attachment could not be added. Try again./)
})

test('resolved feedback controls both title and description, without being parsed again', () => {
  const feedback = resolveAppError('Folder already exists: C:\\Users\\Admin\\demo', 'project.add')
  const html = renderToStaticMarkup(createElement(AppNoticeSurface, {
    title: 'Conversation unavailable',
    message: 'Unable to create that folder.',
    feedback,
  }))
  assert.match(html, /Folder already added/)
  assert.match(html, /Select it from the sidebar/)
  assert.doesNotMatch(html, /Conversation unavailable|Unable to create that folder/)
})
