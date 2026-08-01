const BRAND_ASSET_BASE_URL = `${import.meta.env.BASE_URL}assets/`

export const TIDECODE_MARK_ASSET_URL = `${BRAND_ASSET_BASE_URL}tidecode-mark.svg`
export const TIDECODE_WORD_ASSET_URL = `${BRAND_ASSET_BASE_URL}tidecode-word.svg`
export const TIDECODE_WORDMARK_ASSET_URL = `${BRAND_ASSET_BASE_URL}tidecode-wordmark.svg`

const TIDECODE_APP_ICON_ASSET_URL = `${BRAND_ASSET_BASE_URL}tidecode-icon-light.svg`

export function getTideCodeAppIconAssetUrl() {
  return TIDECODE_APP_ICON_ASSET_URL
}

export function syncTideCodeFavicon() {
  if (typeof document === 'undefined') {
    return
  }

  const favicon = document.querySelector<HTMLLinkElement>('#tidecode-app-icon')
  if (favicon) {
    favicon.href = getTideCodeAppIconAssetUrl()
  }
}
