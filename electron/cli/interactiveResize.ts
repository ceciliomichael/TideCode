export interface InteractiveResizeHost {
  registerResizeHandler: (handler: (() => void) | null) => void
  redrawBackground: () => void
}
