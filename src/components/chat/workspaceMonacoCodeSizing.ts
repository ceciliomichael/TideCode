export const CODE_LINE_HEIGHT_PX = 20
export const CODE_VERTICAL_PADDING_PX = 8
export const MIN_CODE_BLOCK_HEIGHT_PX = CODE_LINE_HEIGHT_PX + CODE_VERTICAL_PADDING_PX * 2

export function resolveInitialCodeContentHeight(code: string) {
  const lineCount = Math.max(1, code.replace(/\r?\n+$/u, '').split(/\r?\n/u).length)
  return lineCount * CODE_LINE_HEIGHT_PX + CODE_VERTICAL_PADDING_PX * 2
}

export function clampRenderedCodeContentHeight(contentHeight: number, maxHeight: number | null) {
  const normalizedHeight = Math.max(MIN_CODE_BLOCK_HEIGHT_PX, Math.ceil(contentHeight))
  return maxHeight === null ? normalizedHeight : Math.min(maxHeight, normalizedHeight)
}
