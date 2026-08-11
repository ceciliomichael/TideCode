export const CHAT_IMAGE_MAX_DIMENSION_PX = 1_568
export const CHAT_IMAGE_TARGET_BYTES = 1_500_000
export const CHAT_IMAGE_OUTPUT_MIME_TYPE = 'image/webp'
export const CHAT_IMAGE_OUTPUT_QUALITY = 0.86

const PROVIDER_NATIVE_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface ImageDimensions {
  height: number
  width: number
}

function normalizeDimension(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
}

export function calculateContainedImageDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumDimension = CHAT_IMAGE_MAX_DIMENSION_PX,
): ImageDimensions {
  const width = normalizeDimension(sourceWidth)
  const height = normalizeDimension(sourceHeight)
  const boundedMaximum = normalizeDimension(maximumDimension)
  const scale = Math.min(1, boundedMaximum / Math.max(width, height))

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  }
}

export function shouldNormalizeChatImage(input: ImageDimensions & { sizeBytes: number }) {
  return (
    input.width > CHAT_IMAGE_MAX_DIMENSION_PX ||
    input.height > CHAT_IMAGE_MAX_DIMENSION_PX ||
    input.sizeBytes > CHAT_IMAGE_TARGET_BYTES
  )
}

export function isProviderNativeImageMimeType(mimeType: string) {
  return PROVIDER_NATIVE_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase())
}
