import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import type { GitHistoryEntry } from '../src/types/chat'
import { GitGraphLane } from '../src/components/sourceControl/historyGraph'
import { computeSwimlanes } from '../src/components/sourceControl/historyGraphLayout'

function commit(hash: string, parentIds: string[] = [], isHead = false): GitHistoryEntry {
  return {
    authorName: 'Test author',
    authoredAt: '2026-10-13T00:00:00Z',
    authoredRelativeTime: 'now',
    graphPrefix: '',
    hash,
    isHead,
    parentIds,
    refs: [],
    shortHash: hash.slice(0, 8),
    subject: hash,
  }
}

test('stash merge and parentless untracked snapshot preserve unrelated history lanes', () => {
  // The sequence that produced the broken graph: main, three-parent WIP stash,
  // index snapshot, parentless untracked snapshot, and a separate code-mode merge.
  const viewModels = computeSwimlanes([
    commit('3288f681', ['db1d9154'], true),
    commit('db1d9154', ['b07d9946']),
    commit('b07d9946', ['8475f7b2']),
    commit('8475f7b2', ['72433102']),
    commit('c2272ecf', ['72433102', '9057f624', 'df48186a']),
    commit('9057f624', ['72433102']),
    commit('df48186a'),
    commit('50de1edc', ['de12653d', 'bd2be5f3']),
    commit('de12653d', ['e71ea9fd']),
    commit('e71ea9fd', ['72433102']),
    commit('72433102', ['ffc276c9']),
    commit('ffc276c9', ['d9721339']),
  ])

  assert.deepEqual(viewModels[4].outputSwimlanes.map((node) => node.id), [
    '72433102', '9057f624', 'df48186a',
  ])
  assert.deepEqual(viewModels[5].outputSwimlanes.map((node) => node.id), [
    '72433102', 'df48186a',
  ])
  assert.deepEqual(viewModels[6].outputSwimlanes.map((node) => node.id), ['72433102'])
  assert.equal(viewModels[6].outputSwimlanes[0].color, viewModels[5].inputSwimlanes[0].color)
  assert.deepEqual(viewModels[7].inputSwimlanes.map((node) => node.id), ['72433102'])

  for (const [index, viewModel] of viewModels.entries()) {
    const outgoingIds = viewModel.outputSwimlanes.map((node) => node.id)
    assert.equal(new Set(outgoingIds).size, outgoingIds.length, `duplicate lanes at row ${index}`)
    for (const parentId of viewModel.entry.parentIds) {
      assert.ok(outgoingIds.includes(parentId), `missing edge to ${parentId} at row ${index}`)
    }
    if (index > 0) {
      assert.deepEqual(viewModel.inputSwimlanes, viewModels[index - 1].outputSwimlanes)
    }
  }
})

test('root commits end only their own lane and remaining lanes shift into place', () => {
  const [first, root, continuing] = computeSwimlanes([
    commit('main', ['root', 'side']),
    commit('root'),
    commit('side', ['ancestor']),
  ])

  assert.deepEqual(first.outputSwimlanes.map((node) => node.id), ['root', 'side'])
  assert.deepEqual(root.outputSwimlanes, [first.outputSwimlanes[1]])
  assert.deepEqual(continuing.inputSwimlanes, root.outputSwimlanes)

  const svg = renderToStaticMarkup(createElement(GitGraphLane, { viewModel: root }))
  assert.match(svg, /d="M 22 0 V 20 C 22 25 11 25 11 30 V 50"/)
  assert.match(svg, /x1="11" y1="0" x2="11" y2="25"/)
})

test('existing parents are reused instead of duplicating lanes, with all incoming edges joined', () => {
  const [first, merge] = computeSwimlanes([
    commit('main', ['branch', 'shared']),
    commit('branch', ['shared', 'shared']),
  ])

  assert.deepEqual(first.outputSwimlanes.map((node) => node.id), ['branch', 'shared'])
  assert.deepEqual(merge.outputSwimlanes.map((node) => node.id), ['shared'])
  assert.equal(merge.outputSwimlanes[0].color, first.outputSwimlanes[1].color)

  const svg = renderToStaticMarkup(createElement(GitGraphLane, { viewModel: merge }))
  assert.match(svg, /d="M 22 0 V 20 C 22 25 11 25 11 30 V 50"/)
  assert.match(svg, /x1="11" y1="25" x2="11" y2="50"/)
})

test('a new commit reconnects its first parent when that parent already occupies a lane', () => {
  const [, side] = computeSwimlanes([
    commit('main', ['shared']),
    commit('side', ['shared']),
  ])

  assert.deepEqual(side.outputSwimlanes.map((node) => node.id), ['shared'])
  const svg = renderToStaticMarkup(createElement(GitGraphLane, { viewModel: side }))
  assert.match(svg, /d="M 22 25 C 22 31 11 31 11 50"/)
  assert.match(svg, /width="33" height="50"/)
})

test('off-lane root dots retain an SVG gutter and do not clip at the right edge', () => {
  const [first, root] = computeSwimlanes([
    commit('main', ['first', 'second']),
    commit('isolated-root'),
  ])

  assert.deepEqual(root.outputSwimlanes, first.outputSwimlanes)
  const svg = renderToStaticMarkup(createElement(GitGraphLane, { viewModel: root }))
  assert.match(svg, /width="44" height="50"/)
  assert.match(svg, /cx="33" cy="25" r="5"/)
})
