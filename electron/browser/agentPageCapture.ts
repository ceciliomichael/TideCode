import type { WebContents } from 'electron'
import { AGENT_BROWSER_HEIGHT, AGENT_BROWSER_WIDTH } from './agentTabs'
import { withBrowserProtocol, type CdpSend } from './agentCdpSession'

/** Keep screenshots, DOM coordinates, and input in the original 1280x720 viewport. */
export async function withAgentViewport<T>(
  contents: WebContents,
  action: (send: CdpSend) => Promise<T>,
): Promise<T> {
  return withBrowserProtocol(contents, async (send) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: AGENT_BROWSER_WIDTH,
      height: AGENT_BROWSER_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    })
    try {
      return await action(send)
    } finally {
      await send('Emulation.clearDeviceMetricsOverride')
    }
  })
}

export async function captureAgentPage(contents: WebContents) {
  // A CDP metrics override changes page layout but does not enlarge an
  // embedded webview's compositor surface. Temporarily enlarge that surface
  // as well so the bottom/right of the 1280x720 page are actually painted.
  const host = contents.hostWebContents
  const guestId = contents.id
  const savedStyle = host && !host.isDestroyed()
    ? await host.executeJavaScript(`(() => {
      const view = Array.from(document.querySelectorAll('webview'))
        .find((node) => node.getWebContentsId?.() === ${guestId});
      if (!view) return null;
      const style = { width: view.style.width, height: view.style.height, minWidth: view.style.minWidth, minHeight: view.style.minHeight };
      view.style.width = '1280px';
      view.style.height = '720px';
      view.style.minWidth = '1280px';
      view.style.minHeight = '720px';
      return style;
    })()`).catch(() => null)
    : null
  try {
    return await withAgentViewport(contents, async (send) => {
      if (savedStyle) {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: AGENT_BROWSER_WIDTH, height: AGENT_BROWSER_HEIGHT, scale: 1 },
    }) as { data?: string }
    if (!result.data) throw new Error('Chromium returned no browser screenshot.')
    const png = Buffer.from(result.data, 'base64')
    if (png.length === 0) throw new Error('The browser screenshot is empty.')
    if (png.length < 24 || png.readUInt32BE(16) !== AGENT_BROWSER_WIDTH
      || png.readUInt32BE(20) !== AGENT_BROWSER_HEIGHT) {
      throw new Error('Chromium did not capture the requested 1280x720 viewport.')
    }
    return png
    })
  } finally {
    if (savedStyle && host && !host.isDestroyed()) {
      await host.executeJavaScript(`(() => {
        const view = Array.from(document.querySelectorAll('webview'))
          .find((node) => node.getWebContentsId?.() === ${guestId});
        if (!view) return;
        view.style.width = ${JSON.stringify(savedStyle.width)};
        view.style.height = ${JSON.stringify(savedStyle.height)};
        view.style.minWidth = ${JSON.stringify(savedStyle.minWidth)};
        view.style.minHeight = ${JSON.stringify(savedStyle.minHeight)};
      })()`).catch(() => undefined)
    }
  }
}
