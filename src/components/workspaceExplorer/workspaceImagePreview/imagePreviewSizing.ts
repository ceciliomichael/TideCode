export const IMAGE_PREVIEW_PADDING_PX = 32

export interface ImagePreviewSize {
  height: number
  width: number
}

export function getImagePreviewFitScale(
  imageSize: ImagePreviewSize,
  viewportSize: ImagePreviewSize,
) {
  if (
    !Number.isFinite(imageSize.width) ||
    !Number.isFinite(imageSize.height) ||
    imageSize.width <= 0 ||
    imageSize.height <= 0 ||
    !Number.isFinite(viewportSize.width) ||
    !Number.isFinite(viewportSize.height) ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return 1
  }

  const availableWidth = Math.max(1, viewportSize.width - IMAGE_PREVIEW_PADDING_PX)
  const availableHeight = Math.max(1, viewportSize.height - IMAGE_PREVIEW_PADDING_PX)

  return Math.min(1, availableWidth / imageSize.width, availableHeight / imageSize.height)
}

export function getImagePreviewCanvasSize(
  imageSize: ImagePreviewSize,
  viewportSize: ImagePreviewSize,
  zoom: number,
  fitScale: number,
) {
  const imageWidth = Math.max(1, imageSize.width * fitScale * zoom)
  const imageHeight = Math.max(1, imageSize.height * fitScale * zoom)

  return {
    height: Math.max(viewportSize.height, imageHeight + IMAGE_PREVIEW_PADDING_PX),
    imageHeight,
    imageWidth,
    width: Math.max(viewportSize.width, imageWidth + IMAGE_PREVIEW_PADDING_PX),
  }
}
