import assert from 'node:assert/strict'
import test from 'node:test'
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

