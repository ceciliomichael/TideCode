import { promises as fs } from 'node:fs'
import path from 'node:path'
import { detectMediaType } from '@ai-sdk/provider-utils'

const MAX_TOOL_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024

/** Read-only image previews can reference an absolute path outside the workspace. */
export async function readToolImagePreview(absolutePath: string): Promise<string | null> {
  if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
    return null
  }

  const stats = await fs.lstat(absolutePath).catch(() => null)
  if (!stats?.isFile() || stats.size > MAX_TOOL_IMAGE_PREVIEW_BYTES) {
    return null
  }

  const data = await fs.readFile(absolutePath).catch(() => null)
  if (!data || data.length > MAX_TOOL_IMAGE_PREVIEW_BYTES) {
    return null
  }

  const mediaType = detectMediaType({ data, topLevelType: 'image' })
  if (!mediaType) {
    return null
  }

  return `data:${mediaType};base64,${data.toString('base64')}`
}
