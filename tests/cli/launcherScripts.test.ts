import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '../..')

test('Windows launcher resolves the installed executable from resources/bin', () => {
  const launcher = readFileSync(resolve(workspaceRoot, 'bin/tidecode.cmd'), 'utf8')

  assert.match(launcher, /INSTALL_DIR=%SCRIPT_DIR%\.\.\\\.\./u)
  assert.match(launcher, /%INSTALL_DIR%\\TideCode\.exe/u)
  assert.match(launcher, /%INSTALL_DIR%\\resources\\app\.asar\\dist-electron\\cli\\index\.js/u)
  assert.match(launcher, /%SCRIPT_DIR%\.\.\\electron\\cli\\index\.ts/u)
  assert.doesNotMatch(launcher, /%~dp0\.\.\\TideCode\.exe/u)
})

test('Unix launcher supports Linux, macOS, and source-checkout layouts', () => {
  const launcher = readFileSync(resolve(workspaceRoot, 'bin/tidecode'), 'utf8')

  assert.match(launcher, /INSTALL_DIR="\$SCRIPT_DIR\/\.\.\/\.\."/u)
  assert.match(launcher, /\$INSTALL_DIR\/resources\/app\.asar\/dist-electron\/cli\/index\.js/u)
  assert.match(launcher, /\$INSTALL_DIR\/MacOS\/TideCode/u)
  assert.match(launcher, /\$SCRIPT_DIR\/\.\.\/electron\/cli\/index\.ts/u)
})
