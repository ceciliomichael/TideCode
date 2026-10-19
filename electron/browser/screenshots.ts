import { randomBytes } from 'node:crypto'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserScreenshot } from '../../src/types/browser'

const screenshotName =
  /^browser-screenshot-[a-z0-9-]+-[a-z0-9]+-[a-f0-9]{8}\.png$/

async function screenshotDirectory(projectPath: string, create: boolean) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new Error('Open a project before taking a browser screenshot.')
  }
  const root = await realpath(projectPath)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('The screenshot project must be a directory.')
  }
  let directory = root
  for (const segment of ['.tidecode', 'browser-screenshots']) {
    directory = path.join(directory, segment)
    if (create) {
      await mkdir(directory, { recursive: true })
    }
    if ((await realpath(directory)) !== directory) {
      throw new Error('The screenshot folder must stay inside the project.')
    }
  }
  return { root, directory }
}

export async function saveBrowserScreenshot(
  projectPath: string,
  url: string,
  png: Buffer,
): Promise<BrowserScreenshot> {
  const { root, directory } = await screenshotDirectory(projectPath, true)
  const hostname =
    new URL(url).hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'page'
  const filename = `browser-screenshot-${hostname}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.png`
  const filePath = path.join(directory, filename)
  await writeFile(filePath, png, { flag: 'wx' })
  return { projectPath: root, filePath }
}

export async function resolveBrowserScreenshot(input: BrowserScreenshot) {
  const { directory } = await screenshotDirectory(input?.projectPath, false)
  if (
    typeof input.filePath !== 'string' ||
    path.dirname(input.filePath) !== directory ||
    !screenshotName.test(path.basename(input.filePath))
  ) {
    throw new Error('Select a saved browser screenshot inside this project.')
  }
  const filePath = await realpath(input.filePath)
  if (filePath !== input.filePath || !(await stat(filePath)).isFile()) {
    throw new Error('The saved browser screenshot is no longer available.')
  }
  return filePath
}
