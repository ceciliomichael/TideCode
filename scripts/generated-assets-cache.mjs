import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'

// Hash the inputs rather than trusting timestamps across checkouts and restores.
export async function generatedAssetsCache({ inputs, outputs, cacheFile, context = '' }) {
  const hash = createHash('sha256')
  hash.update(context)
  for (const input of inputs) {
    hash.update(input)
    hash.update(await readFile(input))
  }
  const fingerprint = hash.digest('hex')

  let fresh = false
  try {
    const cachedFingerprint = await readFile(cacheFile, 'utf8')
    const outputStats = await Promise.all(outputs.map((output) => stat(output)))
    fresh = cachedFingerprint === fingerprint && outputStats.every((output) => output.isFile() && output.size > 0)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  return {
    fresh,
    async commit() {
      await writeFile(cacheFile, fingerprint)
    },
  }
}
