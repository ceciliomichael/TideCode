import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { buildTideHtmlDocument, TIDE_HTML_LIMIT } from '../src/lib/tideui/htmlSandbox'
import { TideUIHtmlPreview } from '../src/components/tideui/TideUIHtmlPreview'
import { buildHtmlPreviewBridge } from '../src/lib/tideui/htmlPreviewBridge'

test('Unified HTML mounts immediately in an opaque sandbox without preview controls', () => {
  const document = buildTideHtmlDocument('<p>Hello</p>')
  assert.match(document, /script-src 'unsafe-inline'/u)
  assert.match(document, /connect-src 'none'/u)
  assert.match(document, /form-action 'none'/u)
  const rendered = renderToStaticMarkup(createElement(TideUIHtmlPreview,{source:'<p>Hello</p>'}))
  assert.match(rendered,/sandbox="allow-scripts allow-forms"/u)
  assert.match(rendered,/referrerPolicy="no-referrer"/u)
  assert.doesNotMatch(rendered, /<button|<dialog|tideui-html-toolbar/u)
  assert.match(document, /currentScript\?\.remove/u)
})

test('Optional inline JavaScript is included immediately while network and privileged access remain blocked', () => {
  const rendered = renderToStaticMarkup(createElement(TideUIHtmlPreview,{source:'<script>1+1</script>'}))
  assert.doesNotMatch(rendered,/Run preview|Restart|Stop/u)
  assert.match(rendered,/<iframe/u)
  const document = buildTideHtmlDocument('<script>1+1</script>')
  for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "worker-src 'none'"]) {
    assert.ok(document.includes(directive), directive)
  }
  assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<script>'))
})

test('Oversized HTML is refused', () => {
  assert.throws(()=>buildTideHtmlDocument('x'.repeat(TIDE_HTML_LIMIT+1)),/60 KB/u)
})

test('Shared styles and theme values remain presentation inside the isolated document', () => {
  const document = buildTideHtmlDocument('<button class="tideui-button">Select</button>', 'token', 'credential', {
    styles: '.tideui-button{background:var(--color-action)}',
    theme: { mode: 'dark', variables: { '--color-action': '#123456' } },
  })

test('explicit custom HTML colors override theme defaults by stylesheet order', () => {
  const document = buildTideHtmlDocument('<style>:root{--color-action:#f0a030}.action{background:#6644ee}</style><button class="action">Custom</button>', 'token', 'credential', {
    styles: '.action{background:var(--color-action)}',
    theme: { mode: 'dark', variables: { '--color-action': '#123456' } },
  })
  assert.ok(document.indexOf('--color-action:#123456') < document.indexOf('--color-action:#f0a030'))
  assert.ok(document.indexOf('.action{background:var(--color-action)}') < document.indexOf('.action{background:#6644ee}'))
  const bridge = buildHtmlPreviewBridge('token', 'credential')
  assert.match(bridge, /data-tide-theme/u)
  assert.doesNotMatch(bridge, /document\.documentElement\.style\.setProperty/u)
})
  assert.match(document, /data-theme="dark"/u)
  assert.match(document, /--color-action:#123456/u)
  assert.ok(document.indexOf('.tideui-button{') < document.indexOf('<button'))
  assert.match(document, /connect-src 'none'/u)
})
