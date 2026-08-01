import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, '..')
const outputDirectory = path.join(rootDirectory, 'build')
const bitmapScale = 2

const colors = {
  aqua: '#2dd4bf',
  bone: '#f7faf9',
  darkTeal: '#0f4c5c',
}

function createInstallerHeaderSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${150 * bitmapScale}" height="${57 * bitmapScale}" viewBox="0 0 150 57">
      <rect width="150" height="57" fill="${colors.bone}" />
      <rect width="150" height="3" fill="${colors.aqua}" />
      <g transform="translate(13 16) scale(0.2)" fill="none" stroke="${colors.darkTeal}" stroke-width="15" stroke-linecap="round">
        <path d="M27,35 L101,35" />
        <path d="M64,35 L64,74 C64,92 77,98 95,90" />
      </g>
      <text x="39" y="37" fill="${colors.darkTeal}" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="-0.5">
        <tspan font-weight="500">Tide</tspan><tspan font-weight="800">Code</tspan>
      </text>
    </svg>
  `
}

function createInstallerSidebarSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${164 * bitmapScale}" height="${314 * bitmapScale}" viewBox="0 0 164 314">
      <rect width="164" height="314" fill="${colors.darkTeal}" />
      <rect width="164" height="6" fill="${colors.aqua}" />
      <g transform="translate(39 92) scale(0.7)" fill="none" stroke="${colors.aqua}" stroke-width="15" stroke-linecap="round">
        <path d="M27,35 L101,35" />
        <path d="M64,35 L64,74 C64,92 77,98 95,90" />
      </g>
    </svg>
  `
}

async function writeRgbBitmap(fileName, svg) {
  const { data, info } = await sharp(Buffer.from(svg))
    .flatten({ background: colors.bone })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const bytesPerPixel = 3
  const rowStride = Math.ceil((info.width * bytesPerPixel) / 4) * 4
  const pixelDataSize = rowStride * info.height
  const headerSize = 14
  const dibHeaderSize = 40
  const bitmap = Buffer.alloc(headerSize + dibHeaderSize + pixelDataSize)

  bitmap.write('BM', 0, 2, 'ascii')
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(headerSize + dibHeaderSize, 10)
  bitmap.writeUInt32LE(dibHeaderSize, headerSize)
  bitmap.writeInt32LE(info.width, headerSize + 4)
  bitmap.writeInt32LE(info.height, headerSize + 8)
  bitmap.writeUInt16LE(1, headerSize + 12)
  bitmap.writeUInt16LE(24, headerSize + 14)
  bitmap.writeUInt32LE(0, headerSize + 16)
  bitmap.writeUInt32LE(pixelDataSize, headerSize + 20)
  bitmap.writeInt32LE(2835, headerSize + 24)
  bitmap.writeInt32LE(2835, headerSize + 28)
  bitmap.writeUInt32LE(0, headerSize + 32)
  bitmap.writeUInt32LE(0, headerSize + 36)

  let destinationOffset = headerSize + dibHeaderSize
  for (let sourceY = info.height - 1; sourceY >= 0; sourceY -= 1) {
    for (let sourceX = 0; sourceX < info.width; sourceX += 1) {
      const sourceOffset = (sourceY * info.width + sourceX) * bytesPerPixel
      bitmap[destinationOffset] = data[sourceOffset + 2]
      bitmap[destinationOffset + 1] = data[sourceOffset + 1]
      bitmap[destinationOffset + 2] = data[sourceOffset]
      destinationOffset += bytesPerPixel
    }

    destinationOffset += rowStride - info.width * bytesPerPixel
  }

  await writeFile(path.join(outputDirectory, fileName), bitmap)
}

await mkdir(outputDirectory, { recursive: true })
await writeRgbBitmap('installerHeader.bmp', createInstallerHeaderSvg())
await writeRgbBitmap('installerSidebar.bmp', createInstallerSidebarSvg())
await writeRgbBitmap('uninstallerSidebar.bmp', createInstallerSidebarSvg())

console.log('Generated TideCode installer artwork in build/.')
