interface ClipboardWriter {
  writeText: (text: string) => Promise<void>
}

interface CopyTextEnvironment {
  clipboard?: ClipboardWriter | null
  document?: Document | null
}

function resolveCopyTextEnvironment(): CopyTextEnvironment {
  return {
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : null,
    document: typeof document !== 'undefined' ? document : null,
  }
}

export async function copyTextToClipboard(
  text: string,
  environment: CopyTextEnvironment = resolveCopyTextEnvironment(),
): Promise<boolean> {
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(text)
      return true
    } catch {
      // Fall through for browsers that expose Clipboard but reject it on non-secure origins.
    }
  }

  const legacyDocument = environment.document
  if (!legacyDocument) {
    return false
  }

  const textArea = legacyDocument.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'
  legacyDocument.body.appendChild(textArea)

  try {
    textArea.focus()
    textArea.select()
    return legacyDocument.execCommand('copy')
  } catch {
    return false
  } finally {
    textArea.remove()
  }
}
