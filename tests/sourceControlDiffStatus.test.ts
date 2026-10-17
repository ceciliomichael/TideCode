import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const source = readFileSync(
  path.join(root, 'src/components/sourceControl/VirtualizedSourceControlDiffList.tsx'),
  'utf8',
)

test('source control file rows show Git status letters without line-count summaries', () => {
  assert.match(source, /diff\.changeStatus === 'untracked' \? 'U'/)
  assert.match(source, /diff\.changeStatus === 'added' \? 'A' : 'M'/)
  assert.match(source, /diff\.changeStatus === 'renamed' \? 'R'/)
  assert.match(source, /diff\.changeStatus === 'modified' \? 'text-git-modified'/)
  assert.match(source, /diff\.changeStatus === 'renamed' \? 'text-git-renamed'/)
  assert.match(source, /Tooltip content=\{normalizedPath\} side="left" noWrap triggerClassName="min-w-0 flex-1"/)
  assert.match(source, /text-git-removed">D<\/span>/)
  assert.doesNotMatch(source, /DiffLineSummary|addedLineCount|removedLineCount/)
})
