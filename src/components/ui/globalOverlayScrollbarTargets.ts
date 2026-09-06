import type { editor } from 'monaco-editor'

export type ScrollAxis = 'horizontal' | 'vertical'

export interface ScrollMetrics {
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
}

export interface CustomScrollTarget {
  element: HTMLElement
  getMetrics: () => ScrollMetrics
  setScrollPosition: (axis: ScrollAxis, position: number) => void
}

export const GLOBAL_OVERLAY_SCROLLBAR_UPDATE_EVENT = 'tidecode:overlay-scrollbar-update'

const customScrollTargets = new WeakMap<HTMLElement, CustomScrollTarget>()

function notifyGlobalOverlayScrollbarUpdate() {
  window.dispatchEvent(new Event(GLOBAL_OVERLAY_SCROLLBAR_UPDATE_EVENT))
}

export function getCustomOverlayScrollTarget(element: HTMLElement) {
  return customScrollTargets.get(element) ?? null
}

export function registerMonacoOverlayScrollbar(editorInstance: editor.ICodeEditor) {
  const element = editorInstance.getDomNode()
  if (!element) {
    return { dispose: () => undefined }
  }

  const target: CustomScrollTarget = {
    element,
    getMetrics: () => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: editorInstance.getScrollHeight(),
      scrollLeft: editorInstance.getScrollLeft(),
      scrollTop: editorInstance.getScrollTop(),
      scrollWidth: editorInstance.getScrollWidth(),
    }),
    setScrollPosition: (axis, position) => {
      if (axis === 'vertical') {
        editorInstance.setScrollTop(position)
      } else {
        editorInstance.setScrollLeft(position)
      }
    },
  }

  customScrollTargets.set(element, target)
  const scrollDisposable = editorInstance.onDidScrollChange(notifyGlobalOverlayScrollbarUpdate)
  const contentSizeDisposable = editorInstance.onDidContentSizeChange(notifyGlobalOverlayScrollbarUpdate)
  notifyGlobalOverlayScrollbarUpdate()

  return {
    dispose: () => {
      if (customScrollTargets.get(element) === target) {
        customScrollTargets.delete(element)
      }
      scrollDisposable.dispose()
      contentSizeDisposable.dispose()
      notifyGlobalOverlayScrollbarUpdate()
    },
  }
}
