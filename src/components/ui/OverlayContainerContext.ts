import { createContext, useContext } from 'react'

/** Widgets embedded in a shadow root keep portals inside their own style scope. */
export const OverlayContainerContext = createContext<HTMLElement | null>(null)
export const OverlayMobileViewportContext = createContext<boolean | null>(null)
export function useOverlayContainer() {
  return useContext(OverlayContainerContext)
}
export function useOverlayMobileViewport() {
  return useContext(OverlayMobileViewportContext)
}
