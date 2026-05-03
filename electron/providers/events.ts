const listeners = new Set<() => void>()

export function onProvidersStateChanged(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitProvidersStateChanged() {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('Failed to notify providers state listener', error)
    }
  }
}
