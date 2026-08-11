import {
  calculateContainedImageDimensions,
  CHAT_IMAGE_MAX_DIMENSION_PX,
  CHAT_IMAGE_OUTPUT_MIME_TYPE,
  CHAT_IMAGE_OUTPUT_QUALITY,
  CHAT_IMAGE_TARGET_BYTES,
  isProviderNativeImageMimeType,
  shouldNormalizeChatImage,
} from './chatImagePolicy'

export interface NormalizedChatImage {
  dataUrl: string
  height: number
  mimeType: string
  sizeBytes: number
  width: number
}

const QUALITY_STEPS = [CHAT_IMAGE_OUTPUT_QUALITY, 0.76, 0.66]
const MAX_NORMALIZATION_PASSES = 3

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to encode the image.'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Unable to encode the image.'))
      }
    }
    reader.readAsDataURL(blob)
  })
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('The browser could not encode the image.'))
      }
    }, CHAT_IMAGE_OUTPUT_MIME_TYPE, quality)
  })
}

function drawBitmap(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) {
    throw new Error('The browser could not prepare the image for the AI model.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

async function encodeBoundedBitmap(bitmap: ImageBitmap) {
  let dimensions = calculateContainedImageDimensions(bitmap.width, bitmap.height)
  let bestResult: { blob: Blob; height: number; width: number } | null = null

  for (let pass = 0; pass < MAX_NORMALIZATION_PASSES; pass += 1) {
    const canvas = drawBitmap(bitmap, dimensions.width, dimensions.height)

    for (const quality of QUALITY_STEPS) {
      const blob = await encodeCanvas(canvas, quality)
      if (!bestResult || blob.size < bestResult.blob.size) {
        bestResult = { blob, ...dimensions }
      }
      if (blob.size <= CHAT_IMAGE_TARGET_BYTES) {
        return { blob, ...dimensions }
      }
    }

    const currentBytes = bestResult?.blob.size ?? CHAT_IMAGE_TARGET_BYTES
    const reduction = Math.min(0.85, Math.max(0.5, Math.sqrt(CHAT_IMAGE_TARGET_BYTES / currentBytes) * 0.92))
    dimensions = calculateContainedImageDimensions(
      Math.round(dimensions.width * reduction),
      Math.round(dimensions.height * reduction),
      CHAT_IMAGE_MAX_DIMENSION_PX,
    )
  }

  if (!bestResult) {
    throw new Error('The browser could not optimize the image.')
  }
  return bestResult
}

export async function normalizeChatImageFile(file: File): Promise<NormalizedChatImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const dimensions = {
      height: bitmap.height,
      width: bitmap.width,
    }
    if (
      isProviderNativeImageMimeType(file.type) &&
      !shouldNormalizeChatImage({ ...dimensions, sizeBytes: file.size })
    ) {
      return {
        dataUrl: await readBlobAsDataUrl(file),
        ...dimensions,
        mimeType: file.type || 'image/png',
        sizeBytes: file.size,
      }
    }

    const normalized = await encodeBoundedBitmap(bitmap)
    return {
      dataUrl: await readBlobAsDataUrl(normalized.blob),
      height: normalized.height,
      mimeType: normalized.blob.type || CHAT_IMAGE_OUTPUT_MIME_TYPE,
      sizeBytes: normalized.blob.size,
      width: normalized.width,
    }
  } finally {
    bitmap.close()
  }
}
