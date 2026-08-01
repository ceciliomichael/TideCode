import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const sourceSvgPath = path.join(rootDir, 'public', 'assets', 'tidecode-icon-light.svg')
const publicAssetsDir = path.join(rootDir, 'public', 'assets')
const outputDir = path.join(rootDir, 'build', 'icons')

if (!existsSync(sourceSvgPath)) {
  throw new Error(`Icon source not found: ${sourceSvgPath}`)
}

await mkdir(outputDir, { recursive: true })
await mkdir(publicAssetsDir, { recursive: true })

for (const theme of ['light', 'dark']) {
  const sourcePath = path.join(publicAssetsDir, `tidecode-icon-${theme}.svg`)
  const outputPath = path.join(publicAssetsDir, `tidecode-icon-${theme}.png`)

  if (!existsSync(sourcePath)) {
    throw new Error(`Icon source not found: ${sourcePath}`)
  }

  await sharp(sourcePath, { density: 1024 })
    .resize(1024, 1024)
    .png()
    .toFile(outputPath)
}

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

for (const size of pngSizes) {
  const outputPath = path.join(outputDir, `${size}x${size}.png`)
  await sharp(sourceSvgPath, { density: 1024 })
    .resize(size, size)
    .png()
    .toFile(outputPath)
}

const linuxIconPath = path.join(outputDir, 'icon.png')
await sharp(sourceSvgPath, { density: 1024 })
  .resize(512, 512)
  .png()
  .toFile(linuxIconPath)

const icoSourcePngs = [16, 24, 32, 48, 64, 128, 256].map((size) => path.join(outputDir, `${size}x${size}.png`))
const icoBuffer = await pngToIco(icoSourcePngs)
await writeFile(path.join(outputDir, 'icon.ico'), icoBuffer)

if (process.platform === 'darwin') {
  const iconsetDir = await mkdtemp(path.join(os.tmpdir(), 'tidecode-iconset-'))
  const iconsetPath = path.join(iconsetDir, 'icon.iconset')
  await mkdir(iconsetPath, { recursive: true })

  const icnsEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]

  for (const [fileName, size] of icnsEntries) {
    await sharp(sourceSvgPath, { density: 1024 })
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetPath, fileName))
  }

  execFileSync('iconutil', ['-c', 'icns', iconsetPath, '-o', path.join(outputDir, 'icon.icns')], { stdio: 'inherit' })
  await rm(iconsetDir, { recursive: true, force: true })
}

console.log(`Electron icons generated from ${sourceSvgPath} -> ${outputDir}`)
