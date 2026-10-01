import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceTab } from '../../../src/components/workspaceExplorer/types'
import {
  findMobileWorkspaceFileViewTab,
  findMobileWorkspacePreviewTab,
  isMobileBinaryPreviewablePath,
  isMobilePreviewablePath,
} from '../../../src/components/workspaceExplorer/mobileWorkspaceExplorerUtils'

function createFileTab(relativePath: string, isBinary = false): WorkspaceTab {
  return {
    kind: 'file',
    tabKey: relativePath,
    content: '',
    originalContent: '',
    fileName: relativePath.split('/').pop() ?? relativePath,
    isBinary,
    isTruncated: false,
    relativePath,
    sizeBytes: 0,
    status: 'ready',
  }
}

test('mobile preview detection covers supported workspace preview formats', () => {
  assert.equal(isMobilePreviewablePath('README.md'), true)
  assert.equal(isMobilePreviewablePath('diagram.svg'), true)
  assert.equal(isMobilePreviewablePath('document.pdf'), true)
  assert.equal(isMobilePreviewablePath('document.docx'), true)
  assert.equal(isMobilePreviewablePath('photo.png'), true)
  assert.equal(isMobilePreviewablePath('src/index.ts'), false)

  assert.equal(isMobileBinaryPreviewablePath('document.pdf'), true)
  assert.equal(isMobileBinaryPreviewablePath('photo.jpg'), true)
  assert.equal(isMobileBinaryPreviewablePath('README.md'), false)
})

test('mobile file view prefers the editable source tab over its preview tab', () => {
  const fileTab = createFileTab('docs/readme.md')
  const previewTab: WorkspaceTab = {
    kind: 'markdown-preview',
    tabKey: 'markdown-preview:docs/readme.md',
    content: '# Readme',
    fileName: 'readme.md',
    isTruncated: false,
    relativePath: 'docs/readme.md',
    status: 'ready',
  }

  assert.equal(
    findMobileWorkspaceFileViewTab([previewTab, fileTab], 'docs/readme.md')?.tabKey,
    fileTab.tabKey,
  )
  assert.equal(
    findMobileWorkspacePreviewTab([fileTab, previewTab], 'docs/readme.md')?.tabKey,
    previewTab.tabKey,
  )
})

test('mobile binary preview uses the loaded file tab while unsupported files have no preview tab', () => {
  const pdfTab = createFileTab('docs/manual.pdf', true)
  const textTab = createFileTab('src/index.ts')

  assert.equal(
    findMobileWorkspacePreviewTab([pdfTab], 'docs/manual.pdf')?.tabKey,
    pdfTab.tabKey,
  )
  assert.equal(findMobileWorkspacePreviewTab([textTab], 'src/index.ts'), null)
})
