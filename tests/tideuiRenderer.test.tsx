import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TideUIBlock } from '../src/components/tideui/TideUIBlock'
import { TideUIMessageBody } from '../src/components/tideui/TideUIMessageBody'

test('TideUI renders native metrics, charts, copy, and send controls', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: ['panel "Build"', '  metric "Tests" 128', '  badge "Passed" success', '  chart line "Activity"', '    point "Mon" 4', '    point "Tue" 7', '  code id=install lang=bash', '    | npm install', '  button "Review" action=send message="Review this build"'].join('\n'),
    actions: {onSend:() => true},
  }))
  assert.match(markup, /Build/u)
  assert.match(markup, /Tests/u)
  assert.match(markup, /npm install/u)
  assert.match(markup, /role="img"/u)
  assert.match(markup, /Review/u)
  assert.match(markup, /Copy/u)
})

test('TideUI renders the reported UI demo with positive tone and working follow-up buttons', () => {
  const source = [
    'panel "UI capabilities"',
    '  heading "A dashboard, right in the conversation"',
    '  text "I can present information as structured components"',
    '  row',
    '    metric "Clarity" 92',
    '    metric "Focus" 85',
    '    badge "Ready" tone=positive',
    '  progress "Example completion" 72',
    '  divider',
    '  button "Show a chart" action=send message="Demonstrate a chart using TideUI."',
    '  button "Show a form" action=send message="Demonstrate a form using TideUI."',
  ].join('\n')
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source,
    actions: { onSend: () => true },
  }))
  assert.match(markup, /UI capabilities/u)
  assert.match(markup, /tideui-status-success/u)
  assert.match(markup, /Example completion/u)
  assert.match(markup, /Show a chart/u)
  assert.match(markup, /Show a form/u)
  assert.doesNotMatch(markup, /tideui-error/u)
})

test('TideUI keeps content visible when an optional presentation property is unknown', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: 'panel "Dashboard" spacing=roomy\n  metric "Requests" 100',
    actions: {},
  }))
  assert.match(markup, /Dashboard/u)
  assert.match(markup, /Requests/u)
  assert.doesNotMatch(markup, /ignored unknown property/u)
  assert.doesNotMatch(markup, /tideui-error/u)
})

test('TideUI accepts checked defaults without warnings', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: 'panel "Focus session"\n  checkbox "Mute notifications" checked=true\n  toggle "Do not disturb" checked=false',
    actions: {},
  }))
  assert.match(markup, /checked=""/u)
  assert.doesNotMatch(markup, /unknown property|tideui-warning/u)
})

test('TideUI renders incremental content instead of a code preview or temporary errors', () => {
  const content = 'Intro\n```tideui\npanel "Focus"\n  metric "Minutes" 25\n  button "Start" action=send message="Start a '
  const markup = renderToStaticMarkup(createElement(TideUIMessageBody, {
    content, isStreaming: true, actions: { onSend: () => true },
  }))
  assert.match(markup, /Focus/u)
  assert.match(markup, /Minutes/u)
  assert.doesNotMatch(markup, /Start a |tideui-error|ignored unknown property/u)
})

test('An unfinished panel renders its chart frame and each completed point progressively', () => {
  const prefix = '```tideui\npanel "More UI capabilities"\n  chart bar "Activity"\n'
  for (const [suffix, pointCount] of [
    ['', 0],
    ['    point "Mon" 4\n', 1],
    ['    point "Mon" 4\n    point "Tue" 7\n', 2],
  ] as const) {
    const markup = renderToStaticMarkup(createElement(TideUIMessageBody, {
      content: prefix + suffix, isStreaming: true, actions: {},
    }))
    assert.match(markup, /More UI capabilities/u)
    assert.match(markup, /<svg/u)
    assert.equal((markup.match(/class="tideui-chart-mark"/gu) ?? []).length, pointCount)
    assert.doesNotMatch(markup, /tideui-chart-placeholder|tideui-error/u)
  }
})

test('A malformed declaration does not replace valid UI when streaming completes', () => {
  const content = '```tideui\npanel "Focus"\n  button "Broken" action=send\n  metric "Minutes" 25\n```'
  const streamed = renderToStaticMarkup(createElement(TideUIMessageBody, {
    content, isStreaming: true, actions: {},
  }))
  assert.match(streamed, /Minutes/u)
  assert.doesNotMatch(streamed, /tideui-error|requires message/u)
  const completed = renderToStaticMarkup(createElement(TideUIMessageBody, {
    content, isStreaming: false, actions: {},
  }))
  assert.match(completed, /Minutes/u)
  assert.doesNotMatch(completed, /tideui-error|requires message/u)
})

test('TideUI timer and hover-aware dashboard render functional native controls', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: [
      'panel "Focus dashboard" hover=highlight',
      '  metric "Requests" 75 hover=lift',
      '  chart bar "Activity" interactive=true',
      '    point "Mon" 25',
      '    point "Tue" 40',
      '  timer "Focus session" id=focus duration=50',
      '  button "Pause timer" action=timer.pause target=focus',
    ].join('\n'),
    actions: {},
  }))
  assert.match(markup, /data-tideui-hover="highlight"/u)
  assert.match(markup, /data-tideui-hover="lift"/u)
  assert.match(markup, /tideui-chart-mark/u)
  assert.match(markup, /Remaining: 50:00/u)
  assert.match(markup, /Start/u)
  assert.match(markup, /Timer is not running/u)
  assert.match(markup, /does not survive a reload/u)
})

test('Generated selects use the shared dropdown and copy buttons use TideCode tooltip triggers', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: [
      'panel "Configuration"',
      '  select "Priority" id=priority default=high',
      '    option low "Low"',
      '    option high "High"',
      '  code id=command lang=bash',
      '    | npm install',
      '  button "Copy settings" action=copy value="priority=high"',
    ].join('\n'),
    actions: {},
  }))
  assert.match(markup, /aria-haspopup="listbox"/u)
  assert.match(markup, /aria-label="Priority"/u)
  assert.match(markup, /tideui-code-copy/u)
  assert.match(markup, /Copy settings/u)
  assert.doesNotMatch(markup, /<select\b/u)
})

test('TideUI tables render completed rows progressively and enable tools after streaming', () => {
  const source = [
    'panel "Results"',
    '  table "Test" "Status"',
    '    row "Parser" "Passed"',
    '    row "Renderer" "Passed"',
    '    row "Security" "Passed"',
    '    row "Streaming" "Passed"',
  ].join('\n')
  const streaming = renderToStaticMarkup(createElement(TideUIBlock, {
    source: `${source}\n`,
    isStreaming: true,
    actions: {},
  }))
  assert.match(streaming, /tideui-markdown-table/u)
  assert.match(streaming, /<table/u)
  assert.match(streaming, /Parser/u)
  assert.doesNotMatch(streaming, /Filter rows|Sort rows/u)

  const blockComplete = renderToStaticMarkup(createElement(TideUIBlock, {
    source,
    isStreaming: true,
    isBlockComplete: true,
    actions: {},
  }))
  assert.match(blockComplete, /tideui-markdown-table/u)
  assert.match(blockComplete, /chat-markdown/u)
  assert.match(blockComplete, /<table/u)
  assert.match(blockComplete, /Parser/u)
  assert.doesNotMatch(blockComplete, /Filter rows|Sort rows/u)

  const final = renderToStaticMarkup(createElement(TideUIBlock, {source, actions: {}}))
  assert.match(final, /Filter rows/u)
  assert.match(final, /Sort rows/u)
  assert.match(final, /aria-haspopup="listbox"/u)
})

test('TideUI Markdown table cells escape untrusted Markdown and HTML values', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: [
      'table "Name" "Value"',
      '  row "Markup" "<img src=x onerror=alert(1)>"',
      '  row "Markdown" "**not bold**"',
    ].join('\n'),
    actions: {},
  }))
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/u)
  assert.doesNotMatch(markup, /<img/u)
  assert.doesNotMatch(markup, /<strong>not bold<\/strong>/u)
  assert.match(markup, /not bold/u)
})

test('TideUI input fields support placeholder and persistent hint text', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: [
      'panel "Profile"',
      '  input "Display name" id=name placeholder="Jane Doe" hint="Shown to collaborators"',
      '  textarea "Notes" id=notes placeholder="Add context" hint="Optional"',
    ].join('\n'),
    actions: {},
  }))
  assert.match(markup, /placeholder="Jane Doe"/u)
  assert.match(markup, /Shown to collaborators/u)
  assert.match(markup, /placeholder="Add context"/u)
  assert.match(markup, /Optional/u)
  assert.match(markup, /aria-describedby="tideui-hint-name"/u)
})

test('explicit native TideUI styles override defaults without replacing base components', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: [
      'card "Custom" background="#202a44" color="#ffffff" radius=lg hover-background="#364969"',
      '  heading "Title" color="#ffcc00"',
      '  metric "Total" 12 background="#112233"',
      '  button "Copy" action=copy value="12" background="#554499"',
      'modal "Details" id=details',
      '  text "Dialog content"',
    ].join('\n'),
    actions: {},
  }))
  assert.match(markup, /background-color:#202a44/u)
  assert.match(markup, /color:#ffffff/u)
  assert.match(markup, /color:#ffcc00/u)
  assert.match(markup, /background-color:#112233/u)
  assert.match(markup, /background-color:#554499/u)
  assert.match(markup, /--tideui-hover-background:#364969/u)
  assert.doesNotMatch(markup, /Dialog content/u)
  assert.match(markup, /tideui-card/u)
})

test('Unsupported button actions are displayed as unavailable instead of live controls', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {
    source: 'panel "Tools"\n  button "Mute notifications" action=notifications.mute',
    actions: {},
  }))
  assert.match(markup, /disabled=""/u)
  assert.match(markup, /This action is not supported/u)
  assert.doesNotMatch(markup, /tideui-error/u)
})

test('Invalid actions are excluded without hiding valid sibling content', () => {
  const markup = renderToStaticMarkup(createElement(TideUIBlock, {source:'button "Bad" action=send\nmetric "Requests" 25',actions:{}}))
  assert.match(markup, /Requests/u)
  assert.doesNotMatch(markup, /tideui-error|<button/u)
})

test('Flexible presentation keeps standalone items and timeline points visible without numeric errors', () => {
  const source = [
    'panel "Flexible UI"',
    '  item "Direct panel content"',
    '  timeline "Milestones"',
    '    point "Today" "Started"',
    '    item "Tomorrow" "Review"',
    '  unfamiliar "<script>alert(1)</script>"',
    '    text "Nested text stays visible"',
    '  chart line "Actual numbers"',
    '    point "Bad value" "Not a number"',
    '    item "Mon" value=25',
    '',
  ].join('\n')
  for (const isStreaming of [true, false]) {
    const markup = renderToStaticMarkup(createElement(TideUIBlock, { source, isStreaming, actions: {} }))
    assert.match(markup, /Direct panel content/u)
    assert.match(markup, /<strong>Today<\/strong><span>Started<\/span>/u)
    assert.match(markup, /Tomorrow/u)
    assert.match(markup, /Nested text stays visible/u)
    assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u)
    assert.match(markup, /<title>Mon: 25<\/title>/u)
    assert.doesNotMatch(markup, /tideui-error|Bad value|<script|NaN/u)
  }
})

test('TideUI is rendered only for assistant fenced blocks and preserves adjacent markdown', () => {
  const content = 'A normal **message**\n```tideui\nmetric "Tasks" 5\n```\nMore text'
  const markup = renderToStaticMarkup(createElement(TideUIMessageBody, {content,isStreaming:false,actions:{}}))
  assert.match(markup, /<strong>message<\/strong>/u)
  assert.match(markup, /Tasks/u)
  assert.match(markup, /More text/u)
})

test('Generated timeline rows and list items render during streaming and after completion', () => {
  const source = [
    'panel "More UI capabilities"',
    '  timeline "Milestones"',
    '    row "Planning" "Scope agreed"',
    '    row "Implementation" "Changes ready"',
    '    row "Verification" "Checks passed"',
    '  list "Next steps"',
    '    item "Review the result"',
    '    item "<script>alert(1)</script>"',
    '    item "Choose a follow-up"',
    '',
  ].join('\n')
  for (const isStreaming of [true, false]) {
    const markup = renderToStaticMarkup(createElement(TideUIBlock, { source, isStreaming, actions: {} }))
    assert.match(markup, /More UI capabilities/u)
    assert.match(markup, /tideui-timeline/u)
    assert.match(markup, /Planning/u)
    assert.match(markup, /Checks passed/u)
    assert.match(markup, /Review the result/u)
    assert.match(markup, /Choose a follow-up/u)
    assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u)
    assert.doesNotMatch(markup, /tideui-error|unknown component|cannot be inside|<script/u)
  }
})

test('Chart point values supplied as properties render their actual numeric values', () => {
  const source = 'chart bar "Activity"\n  point "Mon" value=25\n  point "Tue" value=0\n  point "Wed" -4\n'
  for (const isStreaming of [true, false]) {
    const markup = renderToStaticMarkup(createElement(TideUIBlock, { source, isStreaming, actions: {} }))
    assert.match(markup, /<title>Mon: 25<\/title>/u)
    assert.match(markup, /<title>Tue: 0<\/title>/u)
    assert.match(markup, /<title>Wed: -4<\/title>/u)
    assert.doesNotMatch(markup, /tideui-error|NaN|Infinity/u)
  }
})
