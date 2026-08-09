import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { WorkspaceMarkdownPreviewView } from '../src/components/workspaceExplorer/workspaceMarkdownPreview/WorkspaceMarkdownPreviewView'
import {
  createMarkdownPreviewTabKey,
  getMarkdownPreviewSourcePath,
  isMarkdownPreviewablePath,
} from '../src/lib/markdown-preview'
import { isMermaidErrorSvg } from '../src/components/workspaceExplorer/workspaceMarkdownPreview/mermaid-utils'
import { preprocessMarkdown } from '../src/lib/markdown'


test('isMarkdownPreviewablePath only accepts markdown-like extensions', () => {
  assert.equal(isMarkdownPreviewablePath('README.md'), true)
  assert.equal(isMarkdownPreviewablePath('docs/guide.markdown'), true)
  assert.equal(isMarkdownPreviewablePath('notes.txt'), false)
  assert.equal(isMarkdownPreviewablePath('package.json'), false)
})

test('markdown preview tab keys round-trip to normalized source paths', () => {
  const tabKey = createMarkdownPreviewTabKey('docs\\team\\README.md')

  assert.equal(getMarkdownPreviewSourcePath(tabKey), 'docs/team/README.md')
})

test('getMarkdownPreviewSourcePath rejects unrelated tab keys', () => {
  assert.equal(getMarkdownPreviewSourcePath('workspace-tab::123'), null)
})

test('isMermaidErrorSvg detects Mermaid syntax error output', () => {
  assert.equal(isMermaidErrorSvg('<svg><text>Syntax error in text mermaid version 11.14.0</text></svg>'), true)
  assert.equal(isMermaidErrorSvg('<svg><text>diagram rendered successfully</text></svg>'), false)
})

test('preprocessMarkdown separates glued closing backticks from subsequent headers/markdown', () => {
  const input = `\`\`\`html
<h1>Hello World</h1>
<script src="script.js"></script>
</body>
</html>
\`\`\`### Reviewing Previous Implementation
Previous output created styles.css...`

  const expected = `\`\`\`html
<h1>Hello World</h1>
<script src="script.js"></script>
</body>
</html>
\`\`\`
### Reviewing Previous Implementation
Previous output created styles.css...`

  assert.equal(preprocessMarkdown(input), expected)
})

test('preprocessMarkdown auto-closes unclosed code blocks at the end of markdown content', () => {
  const input = `\`\`\`ts
const x = 42`

  const expected = `\`\`\`ts
const x = 42
\`\`\``

  assert.equal(preprocessMarkdown(input), expected)
})

test('preprocessMarkdown does not turn inline details examples into HTML blocks', () => {
  const input = '- Pricing FAQ: native `<details>/<summary>` accordion (no JS needed)\n\n## Styling / Design System'

  assert.equal(preprocessMarkdown(input), input)
})

test('preprocessMarkdown still separates real details markup from surrounding markdown', () => {
  const input = '<details><summary>FAQ</summary><p>Answer</p></details>'
  const expected = '<details>\n<summary>FAQ</summary>\n<p>Answer</p>\n</details>'

  assert.equal(preprocessMarkdown(input).trim(), expected)
})

test('workspace Markdown preview uses the shared ordered-list marker layout', () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceMarkdownPreviewView, {
      content: '8. FAQ\n9. CTA band\n10. Footer',
      fileName: 'plan-001.md',
    }),
  )

  assert.match(markup, /markdown-ordered-list/u)
  assert.match(markup, /markdown-list-item-content/u)
  assert.match(markup, /--markdown-ordered-list-marker-digits:2/u)
  assert.match(markup, /--markdown-ordered-list-counter-start:7/u)
})

test('ordered Markdown markers inherit the list item typography', async () => {
  const stylesheet = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  const markerRule = stylesheet.match(
    /\.markdown-ordered-list > \.markdown-list-item::before \{([\s\S]*?)\n\s{2}\}/u,
  )?.[1]

  assert.ok(markerRule)
  assert.match(markerRule, /font-family:\s*inherit;/u)
  assert.match(markerRule, /font-size:\s*inherit;/u)
  assert.match(markerRule, /font-weight:\s*inherit;/u)
  assert.match(markerRule, /font-variant:\s*inherit;/u)
  assert.match(markerRule, /font-variant-numeric:\s*inherit;/u)
  assert.doesNotMatch(markerRule, /font-variant-numeric:\s*tabular-nums;/u)
})
