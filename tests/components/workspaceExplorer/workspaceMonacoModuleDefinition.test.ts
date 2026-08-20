import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findWorkspaceMonacoModuleSpecifierRange,
  findWorkspaceMonacoModuleSpecifierRanges,
  getWorkspaceMonacoQuotedModuleSpecifier,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoModuleDefinition'

function selectedText(line: string, column: number) {
  const range = findWorkspaceMonacoModuleSpecifierRange(line, column)
  if (!range) return null
  return line.slice(range.startColumn - 1, range.endColumn - 1)
}

test('Ctrl-hover range covers the entire static import module path', () => {
  const line = "import type { SettingsItemId } from './components/settings/settingsItems'"
  const openingQuoteColumn = line.indexOf("'./components") + 1
  const dotColumn = line.indexOf('./components') + 1
  const slashColumn = line.indexOf('/components') + 1
  const componentsColumn = line.indexOf('components') + 2
  const settingsColumn = line.indexOf('settings/settingsItems') + 2
  const closingQuoteColumn = line.lastIndexOf("'") + 1
  const columns = [
    openingQuoteColumn,
    dotColumn,
    slashColumn,
    componentsColumn,
    settingsColumn,
    closingQuoteColumn,
  ]

  for (const column of columns) {
    assert.equal(selectedText(line, column), './components/settings/settingsItems')
  }
  for (const column of columns.slice(1)) {
    assert.deepEqual(
      findWorkspaceMonacoModuleSpecifierRange(line, column),
      findWorkspaceMonacoModuleSpecifierRange(line, openingQuoteColumn),
    )
  }
})

test('module path range supports side-effect, dynamic, and require imports', () => {
  const sideEffect = "import './styles/app.css'"
  const dynamicImport = "const panel = await import('./components/panel/index')"
  const requireImport = "const config = require('./config/runtime')"

  assert.equal(selectedText(sideEffect, sideEffect.indexOf('styles') + 2), './styles/app.css')
  assert.equal(selectedText(dynamicImport, dynamicImport.indexOf('components') + 2), './components/panel/index')
  assert.equal(selectedText(requireImport, requireImport.indexOf('config/runtime') + 2), './config/runtime')
})

test('module range discovery keeps separate paths independent of slash tokenization', () => {
  const line = "const first = require('./alpha/one'); const second = require('./beta/two')"
  const ranges = findWorkspaceMonacoModuleSpecifierRanges(line)

  assert.deepEqual(
    ranges.map((range) => line.slice(range.startColumn - 1, range.endColumn - 1)),
    ['./alpha/one', './beta/two'],
  )
  assert.deepEqual(
    findWorkspaceMonacoModuleSpecifierRange(line, line.indexOf('/alpha') + 1),
    ranges[0],
  )
  assert.deepEqual(
    findWorkspaceMonacoModuleSpecifierRange(line, line.indexOf('/beta') + 1),
    ranges[1],
  )
})

test('module tooltip text keeps the source relative path quoted', () => {
  const singleQuoted = "import value from './components/settings'"
  const doubleQuoted = 'import value from "../shared/runtime"'
  const [singleRange] = findWorkspaceMonacoModuleSpecifierRanges(singleQuoted)
  const [doubleRange] = findWorkspaceMonacoModuleSpecifierRanges(doubleQuoted)

  assert.ok(singleRange)
  assert.ok(doubleRange)
  assert.equal(getWorkspaceMonacoQuotedModuleSpecifier(singleQuoted, singleRange), "'./components/settings'")
  assert.equal(getWorkspaceMonacoQuotedModuleSpecifier(doubleQuoted, doubleRange), '"../shared/runtime"')
})

test('ordinary strings do not become TypeScript module definition links', () => {
  const line = "const label = './components/settings/settingsItems'"
  assert.equal(findWorkspaceMonacoModuleSpecifierRange(line, line.indexOf('components') + 2), null)
})
