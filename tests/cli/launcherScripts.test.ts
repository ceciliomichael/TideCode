import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '../..')

test('Windows launcher resolves the installed executable from resources/bin', () => {
  const launcher = readFileSync(resolve(workspaceRoot, 'bin/tidecode.cmd'), 'utf8')

  assert.match(launcher, /INSTALL_DIR=%SCRIPT_DIR%\.\.\\\.\./u)
  assert.match(launcher, /CLI_RUNTIME=%SCRIPT_DIR%\.\.\\cli/u)
  assert.match(launcher, /%CLI_RUNTIME%\\node\.exe/u)
  assert.match(launcher, /%CLI_RUNTIME%\\index\.mjs/u)
  assert.match(launcher, /TIDECODE_RESOURCES_PATH=%SCRIPT_DIR%\.\./u)
  assert.match(launcher, /%INSTALL_DIR%\\TideCode\.exe/u)
  assert.match(launcher, /%INSTALL_DIR%\\resources\\app\.asar\\dist-electron\\cli\\index\.js/u)
  assert.match(launcher, /%SCRIPT_DIR%\.\.\\electron\\cli\\index\.ts/u)
  assert.doesNotMatch(launcher, /%~dp0\.\.\\TideCode\.exe/u)
})

test('the packaged CLI build emits the entrypoint used by installed launchers', () => {
  const buildScript = readFileSync(resolve(workspaceRoot, 'scripts/build-cli.mjs'), 'utf8')
  const builderConfig = readFileSync(resolve(workspaceRoot, 'electron-builder.json5'), 'utf8')

  assert.match(buildScript, /path\.join\(workspaceRoot, 'electron', 'cli', 'index\.ts'\)/u)
  assert.match(buildScript, /path\.join\(workspaceRoot, 'dist-electron', 'cli'\)/u)
  assert.match(buildScript, /path\.join\(workspaceRoot, 'dist-cli-runtime'\)/u)
  assert.match(buildScript, /copyFile\(process\.execPath, consoleNodeExecutable\)/u)
  assert.match(buildScript, /cp\(nodePtySource, nodePtyDestination/u)
  assert.match(buildScript, /format:\s*['"]esm['"]/u)
  assert.match(buildScript, /packages:\s*['"]external['"]/u)
  assert.match(builderConfig, /"from": "dist-cli-runtime"/u)
  assert.match(builderConfig, /"to": "cli"/u)
})

test('Unix launcher supports Linux, macOS, and source-checkout layouts', () => {
  const launcher = readFileSync(resolve(workspaceRoot, 'bin/tidecode'), 'utf8')

  assert.match(launcher, /INSTALL_DIR="\$SCRIPT_DIR\/\.\.\/\.\."/u)
  assert.match(launcher, /CLI_RUNTIME="\$SCRIPT_DIR\/\.\.\/cli"/u)
  assert.match(launcher, /exec "\$CLI_RUNTIME\/node" "\$CLI_RUNTIME\/index\.mjs"/u)
  assert.match(launcher, /\$INSTALL_DIR\/resources\/app\.asar\/dist-electron\/cli\/index\.js/u)
  assert.match(launcher, /\$INSTALL_DIR\/MacOS\/TideCode/u)
  assert.match(launcher, /\$SCRIPT_DIR\/\.\.\/electron\/cli\/index\.ts/u)
})
