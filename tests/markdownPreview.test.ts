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

test('preprocessMarkdown preserves shorter fences as literal content inside a longer fence', () => {
  const input = `\`\`\`\`markdown
## Component example
\`\`\`tsx
export const Answer = () => <strong>42</strong>
\`\`\`
\`\`\`\``

  assert.equal(preprocessMarkdown(input), input)
})

test('preprocessMarkdown keeps a longer literal fence when it has no complete nested block', () => {
  const input = `\`\`\`\`markdown
Use three backticks to create a code block.
\`\`\`\``

  assert.equal(preprocessMarkdown(input), input)
})

test('preprocessMarkdown auto-closes an unmatched fence using its original length', () => {
  const input = `\`\`\`\`markdown
\`\`\`json
{"enabled": true}
\`\`\``

  const expected = `${input}
\`\`\`\``

  assert.equal(preprocessMarkdown(input), expected)
})

test('workspace Markdown preview renders a longer Markdown fence as one literal code block', () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceMarkdownPreviewView, {
      content: `\`\`\`\`markdown
\`\`\`python
def hello_world():
    print("Hello, world!")
\`\`\`

\`\`\`javascript
function helloWorld() {
  console.log("Hello, world!")
}
\`\`\`

\`\`\`bash
echo "Hello, world!"
\`\`\`
\`\`\`\``,
    }),
  )

  assert.match(markup, />markdown</u)
  assert.match(markup, /```python/u)
  assert.match(markup, /def hello_world/u)
  assert.match(markup, /```javascript/u)
  assert.match(markup, /function helloWorld/u)
  assert.match(markup, /```bash/u)
  assert.match(markup, /echo &quot;Hello, world!&quot;/u)
  assert.equal(markup.match(/aria-label="Copy code"/gu)?.length, 1)
  assert.match(markup, /data-code-renderer="static"/u)
  assert.match(markup, /overflow-x-auto overflow-y-hidden/u)
})

test('workspace Markdown preview uses static code blocks so wheel input reaches the preview scroller', () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceMarkdownPreviewView, {
      content: 'Before\n\n```ts\nconst value = 42\n```\n\nAfter',
    }),
  )

  assert.match(markup, /workspace-markdown-preview h-full min-h-0 overflow-auto/u)
  assert.match(markup, /data-code-renderer="static"/u)
  assert.doesNotMatch(markup, /data-code-renderer="monaco"/u)
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
