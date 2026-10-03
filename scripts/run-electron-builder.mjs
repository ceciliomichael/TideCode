import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu
const NOISY_DUPLICATE_DEPENDENCY_MESSAGE = 'duplicate dependency references'

function shouldSuppressLine(line) {
  return line
    .replace(ANSI_ESCAPE_PATTERN, '')
    .includes(NOISY_DUPLICATE_DEPENDENCY_MESSAGE)
}

function pipeFilteredOutput(stream, target) {
  let buffered = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffered += chunk

    while (true) {
      const newlineIndex = buffered.indexOf('\n')
      if (newlineIndex < 0) {
        break
      }

      const line = buffered.slice(0, newlineIndex + 1)
      buffered = buffered.slice(newlineIndex + 1)

      if (!shouldSuppressLine(line)) {
        target.write(line)
      }
    }
  })

  stream.on('end', () => {
    if (buffered && !shouldSuppressLine(buffered)) {
      target.write(buffered)
    }
  })
}

const electronBuilderCli = fileURLToPath(
  new URL('../node_modules/electron-builder/cli.js', import.meta.url),
)

const child = spawn(
  process.execPath,
  [electronBuilderCli, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
  },
)

pipeFilteredOutput(child.stdout, process.stdout)
pipeFilteredOutput(child.stderr, process.stderr)

child.on('error', (error) => {
  console.error(`Failed to start electron-builder: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`electron-builder exited after receiving ${signal}`)
    process.exitCode = 1
    return
  }

  process.exitCode = code ?? 1
})
