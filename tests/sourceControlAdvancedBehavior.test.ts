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

test('quick commits preserve explicit approval to stage unstaged changes', () => {
  const controller = read('src/hooks/useChatInterfaceController.ts')
  const quickCommit = controller.slice(
    controller.indexOf('const handleQuickCommit ='),
    controller.indexOf('const handleSourceControlSectionOpenChange ='),
  )

  assert.match(quickCommit, /includeUnstaged:\s*commitInput\.includeUnstaged/)
})

test('unstaged commits use the TideCode confirmation dialog in both entry points', () => {
  const dialog = read('src/components/commit/ConfirmUnstagedCommitDialog.tsx')
  const commitModal = read('src/components/commit/CommitModal.tsx')
  const sourceControlPanel = read('src/components/sourceControl/SourceControlPanel.tsx')

  assert.match(dialog, /role="alertdialog"/)
  assert.match(dialog, /Stage all and commit/)
  assert.match(commitModal, /ConfirmUnstagedCommitDialog/)
  assert.match(sourceControlPanel, /ConfirmUnstagedCommitDialog/)
  assert.doesNotMatch(commitModal, /window\.confirm/)
  assert.doesNotMatch(sourceControlPanel, /window\.confirm/)
})
