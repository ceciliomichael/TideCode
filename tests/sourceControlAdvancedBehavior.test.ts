import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (filePath: string) => readFileSync(path.join(root, filePath), 'utf8')

test('Advanced commit opens the modal without hiding Source Control', () => {
  const controller = read('src/hooks/useChatInterfaceController.ts')
  const section = controller.slice(controller.indexOf('const handleOpenCommitModal ='), controller.indexOf('const handleCloseCommitModal ='))
  assert.match(section, /setIsCommitModalOpen\(true\)/)
  assert.doesNotMatch(section, /onRightPanelOpenChange\(false\)/)
  assert.match(read('src/components/sourceControl/SourceControlChangesSection.tsx'), /onClick=\{onOpenCommitModal\}/)
})

test('switch branch selector waits for checkout and leaves failure visible', () => {
  const selector = read('src/components/chat/GitBranchSelectorField.tsx')
  assert.match(selector, /await onChange\(branchName\)/)
  assert.match(selector, /await onChange\(branchName\)\s*setIsOpen\(false\)/)
  assert.match(selector, /catch \{[^}]*searchInputRef\.current\?\.focus\(\)/s)
  assert.match(selector, /disabled=\{isSwitching\}/)
  assert.match(selector, /isDetachedHead \? 'Detached HEAD'/)
  assert.match(selector, /event\.key === 'Escape' && !isSwitching/)
})

test('Advanced modal only offers remote actions with a configured remote', () => {
  const modal = read('src/components/commit/CommitModal.tsx')
  assert.match(modal, /const hasRemote = Boolean\(branchState\.remoteUrl\)/)
  assert.match(modal, /!hasRemote && step\.value !== 'commit'/)
  assert.match(modal, /includeUnstaged,/)
  assert.match(read('src/components/commit/CommitSuccessDialog.tsx'), /result\.postCommitWarning/)
})
