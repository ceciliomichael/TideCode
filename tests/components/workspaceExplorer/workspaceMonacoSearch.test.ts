import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findWorkspaceSearchMatches,
  replaceAllWorkspaceSearchMatches,
  resolveWorkspaceSearchReplacement,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoSearch'

test('workspace Monaco search supports case and whole-word matching', () => {
  const text = 'cat category CAT cat'

  assert.deepEqual(
    findWorkspaceSearchMatches(text, 'cat', { matchCase: false, regex: false, wholeWord: true })
      .map(({ start, value }) => ({ start, value })),
    [
      { start: 0, value: 'cat' },
      { start: 13, value: 'CAT' },
      { start: 17, value: 'cat' },
    ],
  )
})

test('workspace Monaco search resolves regex captures for one replacement', () => {
  const [match] = findWorkspaceSearchMatches(
    'name: tide',
    '(name): (\\w+)',
    { matchCase: true, regex: true, wholeWord: false },
  )

  assert.equal(
    resolveWorkspaceSearchReplacement(
      match,
      '(name): (\\w+)',
      '$1 = $2',
      { matchCase: true, regex: true, wholeWord: false },
    ),
    'name = tide',
  )
})

test('workspace Monaco replace all preserves literal and regex behavior', () => {
  assert.equal(
    replaceAllWorkspaceSearchMatches(
      'one ONE stone',
      'one',
      'two',
      { matchCase: false, regex: false, wholeWord: true },
    ),
    'two two stone',
  )
  assert.equal(
    replaceAllWorkspaceSearchMatches(
      'v1 v20',
      'v(\\d+)',
      'version-$1',
      { matchCase: true, regex: true, wholeWord: false },
    ),
    'version-1 version-20',
  )
})
