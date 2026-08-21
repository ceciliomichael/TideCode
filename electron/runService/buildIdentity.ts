import { createHash, type Hash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const RUN_SERVICE_BUILD_ID_ENV = 'TIDECODE_RUN_SERVICE_BUILD_ID'
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u

function updateDirectoryHash(hash: Hash, rootPath: string, relativePath = '') {
  const directoryPath = path.join(rootPath, relativePath)
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name
    if (entry.isDirectory()) {
      updateDirectoryHash(hash, rootPath, entryRelativePath)
      continue
    }
    if (!entry.isFile()) continue

    hash.update(entryRelativePath.replaceAll(path.sep, '/'))
    hash.update('\0')
    hash.update(readFileSync(path.join(rootPath, entryRelativePath)))
    hash.update('\0')
  }
}

export function computeRunServiceBuildId(entryPath: string) {
  return createHash('sha256')
    .update('tidecode-run-service-bundle/v1\0')
    .update(readFileSync(entryPath))
    .digest('hex')
}

export function computeSourceRunServiceBuildId(runtimeRoot: string) {
  const hash = createHash('sha256').update('tidecode-run-service-source/v1\0')
  for (const relativeRoot of ['electron', 'src']) {
    const sourceRoot = path.join(runtimeRoot, relativeRoot)
    if (!existsSync(sourceRoot)) continue
    hash.update(relativeRoot)
    hash.update('\0')
    updateDirectoryHash(hash, sourceRoot)
  }

  for (const fileName of ['package.json', 'package-lock.json']) {
    const filePath = path.join(runtimeRoot, fileName)
    if (!existsSync(filePath)) continue
    hash.update(fileName)
    hash.update('\0')
    hash.update(readFileSync(filePath))
    hash.update('\0')
  }

  return hash.digest('hex')
}

export function resolveRunServiceBuildIdFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const buildId = environment[RUN_SERVICE_BUILD_ID_ENV]?.trim().toLowerCase() ?? ''
  if (!SHA256_HEX_PATTERN.test(buildId)) {
    throw new Error('The Tidecode run-service build identity is missing or invalid.')
  }
  return buildId
}
