import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { generatedAssetsCache } from '../../scripts/generated-assets-cache.mjs'

const execFileAsync = promisify(execFile)

test('generated assets invalidate when inputs, platform, or outputs change', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tidecode-assets-'))
  try {
    const input = path.join(directory, 'source.svg')
    const output = path.join(directory, 'icon.png')
    const options = {
      inputs: [input],
      outputs: [output],
      cacheFile: path.join(directory, '.fingerprint'),
      context: 'win32',
    }
    await writeFile(input, 'original')
    assert.equal((await generatedAssetsCache(options)).fresh, false)
    await writeFile(output, 'generated')
    await (await generatedAssetsCache(options)).commit()
    assert.equal((await generatedAssetsCache(options)).fresh, true)
    assert.equal((await generatedAssetsCache({ ...options, context: 'darwin' })).fresh, false)

    // Same-length source edits must invalidate even if timestamps are restored.
    const originalStats = await stat(input)
    await writeFile(input, 'modified')
    await utimes(input, originalStats.atime, originalStats.mtime)
    assert.equal((await generatedAssetsCache(options)).fresh, false)
    await (await generatedAssetsCache(options)).commit()
    assert.equal((await generatedAssetsCache(options)).fresh, true)
    await writeFile(output, '')
    assert.equal((await generatedAssetsCache(options)).fresh, false)
    await rm(output)
    assert.equal((await generatedAssetsCache(options)).fresh, false)
    await rm(input)
    await assert.rejects(generatedAssetsCache(options), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const runtimeDirectory = process.env.TIDECODE_DISTRIBUTION_RUNTIME
test('distribution CLI starts and its trimmed native runtime executes a terminal command', {
  skip: !runtimeDirectory && 'Set TIDECODE_DISTRIBUTION_RUNTIME to test a built distribution',
  timeout: 30_000,
}, async () => {
  const runtime = path.resolve(runtimeDirectory)
  const executable = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node')
  const { stdout: help } = await execFileAsync(executable, [path.join(runtime, 'index.mjs'), '--help'], {
    timeout: 15_000,
  })
  assert.match(help, /Usage:/)
  const nativePackage = path.join(runtime, 'node_modules', 'node-pty')
  const script = `
    const assert = require('node:assert/strict');
    const pty = require(${JSON.stringify(nativePackage)});
    async function check(useConptyDll) {
      const output = await new Promise((resolve, reject) => {
        let output = '';
        const terminal = pty.spawn(
          process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          process.platform === 'win32' ? ['/d', '/c', 'echo TIDECODE_PTY_OK'] : ['-c', 'echo TIDECODE_PTY_OK'],
          { cwd: ${JSON.stringify(runtime)}, env: process.env, useConptyDll },
        );
        const timer = setTimeout(() => {
          terminal.kill();
          reject(new Error('Packaged terminal timed out'));
        }, 10000);
        terminal.onData((data) => { output += data; });
        terminal.onExit(({ exitCode }) => {
          clearTimeout(timer);
          if (exitCode !== 0) {
            reject(new Error('Packaged terminal exited with ' + exitCode));
            return;
          }
          resolve(output);
        });
      });
      assert.match(output, /TIDECODE_PTY_OK/);
    }
    (async () => {
      await check(false);
      console.log('PACKAGED_PTY_OK');
      // node-pty's Windows output worker can remain referenced after shell exit.
      process.exit(0);
    })().catch((error) => { console.error(error); process.exit(1); });
  `
  const { stdout } = await execFileAsync(executable, ['-e', script], { timeout: 25_000 })
  assert.match(stdout, /PACKAGED_PTY_OK/)
  const packageJson = JSON.parse(await readFile(path.join(nativePackage, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, 'node-pty')
})
