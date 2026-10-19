import assert from 'node:assert/strict'
import test from 'node:test'
import { findTideFences } from '../src/lib/tideui/segments'
import { parseStreamingTideUI } from '../src/lib/tideui/streaming'
import { reconcileTideNodes } from '../src/lib/tideui/reconcileNodes'

test('TideUI finds multiple complete blocks with exact boundaries', () => {
  const content = 'Before\n\n```tideui\ncard "Overview"\n```\nAfter\n```tidehtml\n<strong>Hi</strong>\n```'
  const fences = findTideFences(content)
  assert.equal(fences.length, 2)
  assert.equal(fences[0].kind, 'tideui')
  assert.equal(fences[0].closed, true)
  assert.equal(fences[0].source, 'card "Overview"\n')
  assert.equal(fences[1].kind, 'tidehtml')
  assert.equal(content.slice(fences[0].start, fences[0].end).startsWith('```tideui'), true)
})

test('Partial fences stay pending while streamed', () => {
  const content = 'Hello\n```tideui id=report\npanel "Report"\n  heading "Loading"'
  assert.deepEqual(findTideFences(content).map(f => ({closed:f.closed, source:f.source})), [
    {closed:false, source:'panel "Report"\n  heading "Loading"'},
  ])
})

test('Ordinary code fences cannot smuggle TideUI blocks', () => {
  const content = '```markdown\n```tideui\nbutton "Send" action=send message="hello"\n```\n```\n'
  assert.deepEqual(findTideFences(content), [])
})

test('Only the unified HTML fence renders custom HTML; the retired format stays ordinary code', () => {
  const content = '```tideapp\n<script>1+1</script>\n```\n```tidehtml\n<p>Hello</p>\n```'
  assert.deepEqual(findTideFences(content).map(fence => fence.kind), ['tidehtml'])
})

test('Streaming TideUI reveals completed lines without rendering unfinished tokens', () => {
  const incoming = [
    'panel "Focus"',
    '  heading "Focus session"',
    '  metric "Minutes" 25',
    '  button "Start" action=send message="Start a focus session"',
  ]
  const content = incoming.join('\n')
  const first = parseStreamingTideUI('panel "Focus"\n  heading "Focus')
  assert.equal(first.nodes.length, 1)
  assert.equal(first.nodes[0].children.length, 0)
  assert.deepEqual(first.errors, [])

  const second = parseStreamingTideUI('panel "Focus"\n  heading "Focus session"\n  metric "Minutes" 2')
  assert.equal(second.nodes[0].children.length, 1)

  const third = parseStreamingTideUI(content + '\n')
  assert.equal(third.nodes[0].children.length, 3)
  assert.deepEqual(third.errors, [])
})

test('A malformed completed node is skipped without blocking later siblings', () => {
  const parsed = parseStreamingTideUI([
    'panel "Session"',
    '  metric "Minutes" 20',
    '  button "Unsafe" action=send',
    '  button "Continue" action=send message="Continue my session"',
    '',
  ].join('\n'))
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.nodes[0].children.length, 2)
  assert.equal(parsed.nodes[0].children[1].args[0], 'Continue')
  assert.equal(parsed.nodes[0].children[1].line, 4)
})

test('Appending child declarations retains unchanged sibling branches', () => {
  const source = 'panel "Dashboard"\n  metric "Requests" 100\n'
  const previous = parseStreamingTideUI(source).nodes
  const buffered = parseStreamingTideUI(`${source}  chart bar "Activity"\n    point "Mon" 4\n`).nodes
  const withChart = reconcileTideNodes(previous, buffered)
  assert.equal(withChart[0].children[0], previous[0].children[0])
  assert.equal(withChart[0].children[1].kind, 'chart')
  assert.equal(withChart[0].children[1].children.length, 1)

  const appended = parseStreamingTideUI(`${source}  metric "Errors" 0\n`).nodes
  const reconciled = reconcileTideNodes(previous, appended)
  assert.notEqual(reconciled[0], previous[0])
  assert.equal(reconciled[0].children[0], previous[0].children[0])
  assert.equal(reconciled[0].children[1].args[0], 'Errors')

  const changed = parseStreamingTideUI('panel "Dashboard"\n  metric "Requests" 200\n').nodes
  assert.notEqual(reconcileTideNodes(previous, changed)[0].children[0], previous[0].children[0])
})

test('Skipping multiple malformed subtrees preserves original source positions', () => {
  const source = [
    'panel "Dashboard"',
    '  link "Discard" url=javascript:alert(1)',
    '    text "Discard child"',
    '  metric "Requests" 100',
    '  button "Broken" action=send',
    '  input "Notes"',
    '',
  ].join('\n')
  const parsed = parseStreamingTideUI(source)
  assert.deepEqual(parsed.nodes[0].children.map(node => node.line), [4, 6])
})

test('Incomplete unsafe action values stay inert until a full line passes validation', () => {
  const parsed = parseStreamingTideUI('panel "Session"\n  button "Start" action=send message="Continue')
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.nodes[0].children.length, 0)
})

test('Leaf controls are buffered until their full declaration line is complete', () => {
  const partial = parseStreamingTideUI('panel "Actions"\n  button "Start focus')
  assert.equal(partial.nodes.length, 1)
  assert.equal(partial.nodes[0].children.length, 0)

  const complete = parseStreamingTideUI('panel "Actions"\n  button "Start focus" action=send message="Begin focus"\n')
  assert.equal(complete.nodes[0].children.length, 1)
  assert.equal(complete.nodes[0].children[0].args[0], 'Start focus')
})

test('Tables and selects expose completed rows and options before their subtree closes', () => {
  const tableOpen = parseStreamingTideUI([
    'panel "Results"',
    '  table "Name" "Status"',
    '    row "Parser" "Passed"',
    '',
  ].join('\n'))
  assert.equal(tableOpen.nodes[0].children[0].kind, 'table')
  assert.equal(tableOpen.nodes[0].children[0].children[0].args[0], 'Parser')

  const tableClosedBySibling = parseStreamingTideUI([
    'panel "Results"',
    '  table "Name" "Status"',
    '    row "Parser" "Passed"',
    '  button "Continue" action=send message="Continue"',
    '',
  ].join('\n'))
  assert.equal(tableClosedBySibling.nodes[0].children[0].kind, 'table')
  assert.equal(tableClosedBySibling.nodes[0].children[1].kind, 'button')

  const selectOpen = parseStreamingTideUI([
    'panel "Form"',
    '  select "Priority" id=priority',
    '    option low "Low"',
    '',
  ].join('\n'))
  assert.equal(selectOpen.nodes[0].children[0].kind, 'select')
  assert.equal(selectOpen.nodes[0].children[0].children[0].args[0], 'low')

  const selectClosedWithFence = parseStreamingTideUI([
    'panel "Form"',
    '  select "Priority" id=priority',
    '    option low "Low"',
  ].join('\n'), { blockComplete: true })
  assert.equal(selectClosedWithFence.nodes[0].children[0].kind, 'select')
})

test('Charts append each completed point inside a still-streaming panel', () => {
  const source = 'panel "More UI capabilities"\n  chart bar "Activity"\n'
  const empty = parseStreamingTideUI(source)
  assert.equal(empty.nodes[0].children[0].kind, 'chart')
  assert.equal(empty.nodes[0].children[0].children.length, 0)

  const first = parseStreamingTideUI(`${source}    point "Mon" 4\n`)
  assert.equal(first.nodes[0].children[0].children.length, 1)
  const partial = parseStreamingTideUI(`${source}    point "Mon" 4\n    point "Tue" `)
  assert.deepEqual(partial.nodes, first.nodes)

  const second = parseStreamingTideUI(`${source}    point "Mon" 4\n    point "Tue" 7\n`)
  const reconciled = reconcileTideNodes(first.nodes, second.nodes)
  assert.equal(reconciled[0].children[0].children.length, 2)
  assert.equal(reconciled[0].children[0].children[0], first.nodes[0].children[0].children[0])
})

test('Other child-driven widgets commit individual parts without waiting for a sibling or closing fence', () => {
  for (const [declaration, child] of [
    ['timeline', 'event "Today" "Started"'],
    ['flow', 'node "Start" id=start'],
    ['list', 'text "First item"'],
    ['tabs "Views"', 'tab "First"'],
    ['expand "Details"', 'text "First detail"'],
  ]) {
    const parsed = parseStreamingTideUI(`${declaration}\n  ${child}\n`)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.nodes[0].children.length, 1, declaration)
  }
})

test('Timeline rows and list items commit per completed line and retain earlier entries', () => {
  for (const [parent, entry] of [['timeline "Milestones"', 'row'], ['list "Tasks"', 'item']]) {
    const prefix = `panel "Capabilities"\n  ${parent}\n    ${entry} "First" "Ready"\n`
    const first = parseStreamingTideUI(prefix)
    assert.deepEqual(first.errors, [])
    assert.equal(first.nodes[0].children[0].children.length, 1)
    const partial = parseStreamingTideUI(`${prefix}    ${entry} "Second`)
    assert.deepEqual(partial.nodes, first.nodes)
    const next = parseStreamingTideUI(`${prefix}    ${entry} "Second" "Pending"\n`)
    const nodes = reconcileTideNodes(first.nodes, next.nodes)
    assert.equal(nodes[0].children[0].children.length, 2)
    assert.equal(nodes[0].children[0].children[0], first.nodes[0].children[0].children[0])
  }
})

test('A completed value-property point appears without dropping earlier valid points', () => {
  const prefix = 'chart line "Values"\n  point "First" value=25\n'
  const first = parseStreamingTideUI(prefix)
  assert.equal(first.nodes[0].children.length, 1)
  assert.deepEqual(parseStreamingTideUI(`${prefix}  point "Second" value=`).nodes, first.nodes)
  const next = parseStreamingTideUI(`${prefix}  point "Second" value=0\n`)
  assert.equal(next.nodes[0].children.length, 2)
})
