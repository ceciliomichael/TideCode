import assert from 'node:assert/strict'
import test from 'node:test'
import type { Monaco } from '@monaco-editor/react'
import {
  createWorkspaceMonacoModelPath,
  createWorkspaceMonacoOptions,
  defineWorkspaceMonacoThemes,
  getWorkspaceMonacoTheme,
  resolveWorkspaceMonacoLanguage,
  WORKSPACE_MONACO_DARK_THEME,
  WORKSPACE_MONACO_DARK_THEME_DATA,
  WORKSPACE_MONACO_LIGHT_THEME,
  WORKSPACE_MONACO_LIGHT_THEME_DATA,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'

test('workspace Monaco uses VS Code wrapping indentation when word wrap is enabled', () => {
  const options = createWorkspaceMonacoOptions(true)

  assert.equal(options.wordWrap, 'on')
  assert.equal(options.wrappingIndent, 'same')
  assert.equal(options.wrappingStrategy, 'advanced')
  assert.equal(options.tabSize, 2)
  assert.equal(options.insertSpaces, true)
  assert.equal(options.lineDecorationsWidth, 18)
  assert.equal(options.lineNumbersMinChars, 5)
  assert.equal(options.folding, true)
  assert.equal(options.showFoldingControls, 'mouseover')
  assert.equal(options.renderLineHighlight, 'none')
})

test('workspace Monaco disables wrapping without changing wrapped indentation semantics', () => {
  const options = createWorkspaceMonacoOptions(false)

  assert.equal(options.wordWrap, 'off')
  assert.equal(options.wrappingIndent, 'same')
})

test('workspace Monaco resolves common and special file languages', () => {
  assert.equal(resolveWorkspaceMonacoLanguage('src\\components\\Button.tsx'), 'typescript')
  assert.equal(resolveWorkspaceMonacoLanguage('config/settings.jsonc'), 'json')
  assert.equal(resolveWorkspaceMonacoLanguage('Dockerfile'), 'dockerfile')
  assert.equal(resolveWorkspaceMonacoLanguage('AGENTS.md'), 'markdown')
  assert.equal(resolveWorkspaceMonacoLanguage('LICENSE'), 'plaintext')
})

test('workspace Monaco creates stable encoded file model paths', () => {
  assert.equal(
    createWorkspaceMonacoModelPath('src\\feature folder\\index.ts'),
    'file:///workspace/src/feature%20folder/index.ts',
  )
  assert.equal(createWorkspaceMonacoModelPath(''), 'file:///workspace/untitled')
})

test('workspace Monaco maps TideCode appearance to registered editor themes', () => {
  assert.equal(getWorkspaceMonacoTheme('light'), WORKSPACE_MONACO_LIGHT_THEME)
  assert.equal(getWorkspaceMonacoTheme('dark'), WORKSPACE_MONACO_DARK_THEME)
  assert.equal(WORKSPACE_MONACO_LIGHT_THEME_DATA.colors?.['editor.selectionBackground'], '#1e76ce')
  assert.equal(WORKSPACE_MONACO_DARK_THEME_DATA.colors?.['editor.selectionBackground'], '#246fb0')
  assert.equal(WORKSPACE_MONACO_LIGHT_THEME_DATA.colors?.['diffEditor.insertedLineBackground'], '#10b9812e')
  assert.equal(WORKSPACE_MONACO_DARK_THEME_DATA.colors?.['diffEditor.removedLineBackground'], '#ef44443d')
  assert.equal(WORKSPACE_MONACO_LIGHT_THEME_DATA.colors?.['diffEditor.insertedTextBackground'], '#00000000')
  assert.equal(WORKSPACE_MONACO_LIGHT_THEME_DATA.colors?.['diffEditor.removedTextBackground'], '#00000000')
  assert.equal(WORKSPACE_MONACO_DARK_THEME_DATA.colors?.['diffEditor.insertedTextBackground'], '#00000000')
  assert.equal(WORKSPACE_MONACO_DARK_THEME_DATA.colors?.['diffEditor.removedTextBackground'], '#00000000')
  assert.equal(WORKSPACE_MONACO_LIGHT_THEME_DATA.inherit, true)
  assert.equal(WORKSPACE_MONACO_DARK_THEME_DATA.inherit, true)
})

test('workspace Monaco defines shared themes only once per runtime instance', () => {
  const definedThemeNames: string[] = []
  const monaco = {
    editor: {
      defineTheme(themeName: string) {
        definedThemeNames.push(themeName)
      },
    },
  } as unknown as Monaco

  defineWorkspaceMonacoThemes(monaco)
  defineWorkspaceMonacoThemes(monaco)

  assert.deepEqual(definedThemeNames, [
    WORKSPACE_MONACO_LIGHT_THEME,
    WORKSPACE_MONACO_DARK_THEME,
  ])
})
