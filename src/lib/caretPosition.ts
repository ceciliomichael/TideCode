// The properties that we copy into a mirrored div.
// Note that some browsers, such as Firefox, do not concatenate properties
// into their shorthand (e.g. padding-top, padding-bottom etc. -> padding),
// so we have to list every single property explicitly.
const properties = [
  'direction', // RTL support
  'boxSizing',
  'width', // on Chrome and IE, exclude the scrollbar, so the mirror div wraps exactly as the textarea does
  'height',
  'overflowX',
  'overflowY', // copy the scrollbar for IE

  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',

  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',

  // https://developer.mozilla.org/en-US/docs/Web/CSS/font
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',

  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration', // might not make a difference, but better be safe

  'letterSpacing',
  'wordSpacing',

  'tabSize',
  'MozTabSize',
] as const

const isBrowser = typeof window !== 'undefined'
const isFirefox = isBrowser && window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1

export function getCaretBoundingRect(element: HTMLTextAreaElement, position: number): DOMRect | null {
  if (!isBrowser) {
    return null
  }

  // The mirror div will replicate the textarea's style
  const div = document.createElement('div')
  div.id = 'input-textarea-caret-position-mirror-div'
  document.body.appendChild(div)

  const style = div.style
  const computed = window.getComputedStyle(element)
  const isInput = element.nodeName === 'INPUT'

  // Default textarea styles
  style.whiteSpace = 'pre-wrap'
  if (!isInput) style.wordWrap = 'break-word' // only for textarea-s

  // Position off-screen
  style.position = 'absolute'
  style.visibility = 'hidden'

  // Transfer the element's properties to the div
  properties.forEach((prop) => {
    if (isInput && prop === 'lineHeight') {
      // Special case for <input>s because text is rendered centered and line height may be != height
      if (computed.boxSizing === 'border-box') {
        const height = parseInt(computed.height)
        const outerHeight =
          parseInt(computed.paddingTop) +
          parseInt(computed.paddingBottom) +
          parseInt(computed.borderTopWidth) +
          parseInt(computed.borderBottomWidth)
        const targetHeight = outerHeight + parseInt(computed.lineHeight)
        if (height > targetHeight) {
          style.lineHeight = height - outerHeight + 'px'
        } else if (height === targetHeight) {
          style.lineHeight = computed.lineHeight
        } else {
          style.lineHeight = '0'
        }
      } else {
        style.lineHeight = computed.height
      }
    } else {
      style[prop as any] = computed[prop as any]
    }
  })

  if (isFirefox) {
    // Firefox lies about the overflow property for textareas: https://bugzilla.mozilla.org/show_bug.cgi?id=98356
    // and input: https://bugzilla.mozilla.org/show_bug.cgi?id=739173
    if (element.scrollHeight > parseInt(computed.height)) style.overflowY = 'scroll'
  } else {
    style.overflow = 'hidden' // for Chrome to not render a scrollbar; IE keeps overflowY = 'scroll'
  }

  div.textContent = element.value.substring(0, position)
  
  if (isInput) {
    // for input, text content needs to replace spaces with non-breaking spaces
    // because consecutive spaces are collapsed in HTML divs
    div.textContent = div.textContent.replace(/\s/g, '\u00a0')
  }

  const span = document.createElement('span')
  // Wrapping must be left to the parent div
  span.textContent = element.value.substring(position) || '.' // || because a completely empty span doesn't render
  div.appendChild(span)

  const spanRect = span.getBoundingClientRect()
  const divRect = div.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  const top = elementRect.top + (spanRect.top - divRect.top) - element.scrollTop
  const left = elementRect.left + (spanRect.left - divRect.left) - element.scrollLeft

  // Remove the mirror div
  document.body.removeChild(div)

  // We return a DOMRect-like object that floats over the caret
  return {
    bottom: top + spanRect.height,
    height: spanRect.height,
    left,
    right: left + spanRect.width,
    top,
    width: spanRect.width,
    x: left,
    y: top,
    toJSON: () => null,
  }
}
