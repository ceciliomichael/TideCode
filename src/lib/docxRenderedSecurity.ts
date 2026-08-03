const REMOVED_ELEMENTS = 'base, embed, form, iframe, object, script'
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function isAllowedUrl(value: string, attributeName: string) {
  const normalizedValue = value.trim()
  if (attributeName === 'href' && normalizedValue.startsWith('#')) {
    return true
  }

  if (attributeName === 'src' && normalizedValue.toLowerCase().startsWith('data:image/')) {
    return true
  }

  try {
    const parsedUrl = new URL(normalizedValue, window.location.origin)
    if (attributeName === 'src') {
      return parsedUrl.protocol === 'data:' && parsedUrl.pathname.toLowerCase().startsWith('image/')
    }
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)
  } catch {
    return false
  }
}

export function sanitizeDocxRenderedDom(container: HTMLElement) {
  container.querySelectorAll(REMOVED_ELEMENTS).forEach((element) => element.remove())
  container.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const normalizedName = attribute.name.toLowerCase()
      if (normalizedName.startsWith('on')) {
        element.removeAttribute(attribute.name)
        return
      }

      if ((normalizedName === 'href' || normalizedName === 'src') && !isAllowedUrl(attribute.value, normalizedName)) {
        element.removeAttribute(attribute.name)
        return
      }

      if (normalizedName === 'href' && isAllowedUrl(attribute.value, normalizedName)) {
        const parsedUrl = attribute.value.startsWith('#') ? null : new URL(attribute.value, window.location.origin)
        if (parsedUrl && parsedUrl.origin !== window.location.origin) {
          element.setAttribute('rel', 'noreferrer noopener')
          element.setAttribute('target', '_blank')
        }
      }
    })
  })
}
