import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const generatedDirectories = ['dist', 'dist-electron']

function assertSafeGeneratedDirectory(directoryPath) {
  const relativePath = path.relative(repositoryRoot, directoryPath)

  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to remove an unsafe build path: ${directoryPath}`)
  }
}

async function removeGeneratedDirectory(directoryName) {
  const directoryPath = path.join(repositoryRoot, directoryName)
  assertSafeGeneratedDirectory(directoryPath)

  await fs.rm(directoryPath, {
    force: true,
    recursive: true,
  })

  console.log(`Cleaned generated build output: ${directoryName}`)
}

async function main() {
  await Promise.all(generatedDirectories.map((directoryName) => removeGeneratedDirectory(directoryName)))
}

main().catch((error) => {
  console.error('Failed to clean generated build output.', error)
  process.exitCode = 1
})
