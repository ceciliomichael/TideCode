import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTideUI, tokenizeTideUILine } from '../src/lib/tideui/parser'
import { validateTideUI } from '../src/lib/tideui/validate'

test('TideUI reads compact quoted properties and nested raw lines', () => {
  const result = validateTideUI([
    'panel "Build report"',
    '  grid 2',
    '    metric "Commits" 142',
    '    metric "Changed files" 38',
    '  code id=install lang=bash copy',
    '    | npm install',
    '  button "Analyze" action=send message="Analyze this repository"',
  ].join('\n'))
  assert.deepEqual(result.errors, [])
  assert.equal(result.nodes[0].children[0].children.length, 2)
  assert.equal(result.nodes[0].children[1].text, 'npm install')
  assert.equal(result.nodes[0].children[2].props.message, 'Analyze this repository')
})

test('TideUI quoting supports escaped quotes and spaces', () => {
  assert.deepEqual(tokenizeTideUILine('button "A \\"quote\\"" message="Check source files"'), ['button', 'A "quote"', 'message=Check source files'])
})

test('TideUI supports tone aliases and ignores unsupported cosmetic attributes without losing a dashboard', () => {
  const result = validateTideUI([
    'panel "UI capabilities"',
    '  row spacing=wide',
    '    metric "Clarity" 92',
    '    badge "Ready" tone=positive',
    '  progress "Example completion" 72',
    '  button "Show a chart" action=send message="Demonstrate a chart using TideUI."',
  ].join('\n'))
  assert.deepEqual(result.errors, [])
  assert.equal(result.nodes.length, 1)
  assert.equal(result.nodes[0].children[0].children[1].props.tone, 'positive')
  assert.deepEqual(result.warnings, ['Line 2: ignored unknown property "spacing"'])
})

test('TideUI disables unsupported actions while rejecting invalid behavioral properties', () => {
  const result = validateTideUI('button "Run" action=execute\nbutton "Unsafe" onClick=evil')
  assert.equal(result.nodes.length, 0)
  assert.ok(result.warnings.some(warning => warning.includes('unsupported action')))
  assert.ok(result.errors.some(error => error.includes('invalid property')))
})

test('TideUI accepts bounded timers and safe theme-driven hover styles', () => {
  const result = validateTideUI([
    'panel "Analytics" hover=highlight',
    '  metric "Requests" 1240 hover=glow',
    '  chart bar "Daily activity" interactive=true',
    '    point "Mon" 25',
    '  timer "Focus session" id=focus duration=50',
    '  button "Pause" action=timer.pause target=focus',
  ].join('\n'))
  assert.deepEqual(result.errors, [])
  assert.equal(result.nodes[0].children[2].kind, 'timer')

  const invalid = validateTideUI('timer "Too long" id=t duration=900\ncard "Bad" hover=javascript')
  assert.equal(invalid.nodes.length, 0)
  assert.ok(invalid.errors.some(error => error.includes('duration')))
  assert.ok(invalid.errors.some(error => error.includes('hover')))
})

test('native TideUI accepts explicit design tokens and validates hostile style values', () => {
  const document = validateTideUI([
    'card "Dashboard" background="#202a44" color="#ffffff" radius=lg padding=18px hover-background="#304060"',
    '  heading "My custom design" font-size=20px',
    '  button "Details" action=modal.open target=details color="#fefefe"',
    'modal "Details" id=details size=lg',
    '  text "Information" border-color="#8299cc"',
    '  button "Close" action=modal.close',
  ].join('\n'))
  assert.deepEqual(document.errors, [])
  assert.equal(document.nodes[0].props.background, '#202a44')
  assert.equal(document.nodes[1].children[1].props.action, 'modal.close')

  const unsafe = validateTideUI('card "Bad" background="url(javascript:alert(1))"')
  assert.ok(unsafe.errors.some(error => error.includes('invalid background style')))
  assert.equal(unsafe.nodes.length, 0)
})

test('custom HTML is available within native modals while non-dismissible modals require close actions', () => {
  const valid = validateTideUI([
    'button "Custom preview" action=modal.open target=preview',
    'modal "Custom preview" id=preview size=lg dismiss=false background="#161e2b"',
    '  html',
    '    | <div style="background:#123456;color:white">Example</div>',
    '  button "Close" action=modal.close',
  ].join('\n'))
  assert.deepEqual(valid.errors, [])
  assert.equal(valid.nodes[1].children[0].kind, 'html')
  assert.match(valid.nodes[1].children[0].text, /background:#123456/u)

  const invalid = validateTideUI('modal "Blocked" id=blocked dismiss=false\n  text "No escape"')
  assert.ok(invalid.errors.some(error => error.includes('requires a close button')))

  const nestedClose = validateTideUI('modal "Settings" id=settings dismiss=false\n  row\n    button "Cancel" action=modal.close')
  assert.deepEqual(nestedClose.errors, [])
})

test('TideUI preserves unknown presentation as text but rejects invalid properties, indentation and duplicate ids', () => {
  const document = validateTideUI('javascript "alert(1)"\n panel "bad"\nmetric "A" 1 id=dup\nmetric "B" 2 id=dup\ntext "Hi" onClick=evil')
  assert.equal(document.nodes.length, 0)
  assert.ok(document.warnings.some(warning => warning.includes('rendered as text')))
  assert.ok(document.errors.some(error => error.includes('two-space')))
  assert.ok(document.errors.some(error => error.includes('duplicate id')))
  assert.ok(document.errors.some(error => error.includes('invalid property')))
})

test('TideUI rejects unsafe links and malformed send actions', () => {
  const document = validateTideUI('link "Run" url=javascript:alert(1)\nbutton "Send" action=send\nchart scatter')
  assert.equal(document.nodes.length, 0)
  assert.ok(document.errors.some(error => error.includes('unsupported URL')))
  assert.ok(document.errors.some(error => error.includes('requires message')))
  assert.ok(document.errors.some(error => error.includes('chart type')))
})

test('TideUI parser limits node counts and source size', () => {
  assert.match(parseTideUI('text "x"\n'.repeat(251)).errors.join(' '), /250-component/u)
  assert.match(parseTideUI('x'.repeat(40_001)).errors.join(' '), /40 KB/u)
})

test('TideUI accepts generated item entries and timeline rows without discarding the panel', () => {
  const source = [
    'panel "More UI capabilities"',
    '  timeline "Project milestones"',
    '    row "Plan" "Scope agreed"',
    '    event "Build" "Implementation ready"',
    '    row "Verify" "Checks passed"',
    '  list "Next steps"',
    '    item "Review the result"',
    '    item "Choose a follow-up"',
    '  comparison "Options"',
    '    item "Option A" "Fast"',
  ].join('\n')
  const document = validateTideUI(source)
  assert.deepEqual(document.errors, [])
  assert.deepEqual(document.nodes[0].children[0].children.map(node => node.kind), ['event', 'event', 'event'])
  assert.equal(document.nodes[0].children[1].children.length, 2)
  assert.equal(document.nodes[0].children[2].children[0].args[1], 'Fast')
})

test('Standalone items are accepted while invalid child controls and unsafe values stay rejected', () => {
  const document = validateTideUI([
    'item "Orphan"',
    'timeline "Invalid children"',
    '  button "Run" action=copy value="x"',
    'list "Unsafe entry"',
    '  item "Bad" url=javascript:alert(1)',
  ].join('\n'))
  assert.equal(document.nodes.length, 0)
  assert.ok(document.errors.some(error => error.includes('button cannot be inside timeline')))
  assert.ok(document.errors.some(error => error.includes('unsupported URL')))
})

test('Entry-like declarations take their meaning from their parent', () => {
  const document = validateTideUI([
    'panel "Flexible UI"',
    '  item "Standalone entry"',
    '  timeline "Milestones"',
    '    point "Today" "Started"',
    '    item "Tomorrow" "Review"',
    '  chart bar "Activity"',
    '    row "Mon" value=10',
    '  table "Name" "Status"',
    '    item "Parser" "Ready"',
    '  select "Priority"',
    '    item low "Low"',
    '  unfamiliar "Safe literal" "Additional detail"',
    '    text "Nested text stays visible"',
  ].join('\n'))
  assert.deepEqual(document.errors, [])
  const children = document.nodes[0].children
  assert.equal(children[0].kind, 'item')
  assert.equal(children[1].children[0].kind, 'event')
  assert.equal(children[1].children[0].args[1], 'Started')
  assert.equal(children[2].children[0].kind, 'point')
  assert.equal(children[3].children[0].kind, 'row')
  assert.equal(children[4].children[0].kind, 'option')
  assert.equal(children[5].kind, 'text')
  assert.equal(children[5].args[0], 'Safe literal · Additional detail')
  assert.equal(children[5].children[0].args[0], 'Nested text stays visible')
})

test('Chart points accept finite positional and value-property numbers', () => {
  const document = validateTideUI([
    'chart line "Values"',
    '  point "Positive" value=25',
    '  point "Zero" value=0',
    '  point "Negative" -4',
    '  point "Decimal" value=2.5',
  ].join('\n'))
  assert.deepEqual(document.errors, [])
  assert.equal(document.nodes[0].children.length, 4)
  for (const value of ['', 'value=""', 'value=NaN', 'value=Infinity', 'value=abc']) {
    const invalid = validateTideUI(`chart line "Values"\n  point "Invalid" ${value}`)
    assert.ok(invalid.errors.some(error => error.includes('point requires a numeric value')), value)
  }
})
