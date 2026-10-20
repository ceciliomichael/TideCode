import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist-cli-runtime')
const child = fork(path.join(directory, 'code-mode-worker.mjs'), [], {
  execPath: path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node'),
  execArgv: ['--no-node-snapshot'],
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
const timer = setTimeout(() => {
  child.kill()
  throw new Error('Packaged Code Mode smoke check timed out.')
}, 10000)
try {
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Worker exited before completing: ${code}`)))
    child.on('message', (message) => {
      if (message.type === 'tool') {
        assert.equal(message.path, 'echo')
        assert.deepEqual(message.args, [{ value: 42 }])
        child.send({ type: 'tool-result', id: message.id, value: { body: 'verified' } })
      } else resolve(message)
    })
    child.send({
      type: 'execute', paths: ['echo'], payloads: { text: 'exact payload' },
      limits: { memoryLimitMb: 32, timeoutMs: 5000, maxOutputBytes: 10000, maxPayloadBytes: 10000 },
      source: `await new Promise(resolve => setTimeout(resolve, 5));
        const result = await tools.echo({ value: Number('42') });
        return { body: result.body, payload: payloads.text, native: [...new Set([1, 1, 2])], host: typeof process };`,
    })
  })
  assert.equal(result.type, 'result', JSON.stringify(result))
  assert.deepEqual(result.output, { body: 'verified', payload: 'exact payload', native: [1, 2], host: 'undefined' })
  console.log('Packaged Code Mode: native V8, timers, tool bridge, payloads and host isolation verified.')
} finally {
  clearTimeout(timer)
  child.kill()
}
