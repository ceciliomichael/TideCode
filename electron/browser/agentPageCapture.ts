import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { DEFAULT_AGENT_VIEWPORT, getAgentViewport, resolveAgentViewport, type AgentViewport } from './agentViewport'
import { withBrowserProtocol, type CdpSend } from './agentCdpSession'
import { AgentBrowserOperation } from './agentBrowserOperation'

/** Keep layout, screenshots, element measurement and input in one coordinate space. */
export async function withAgentViewport<T>(
  contents: WebContents,
  action: (send: CdpSend, viewport: Readonly<AgentViewport>) => Promise<T>,
  requestedViewport: AgentViewport = getAgentViewport(contents),
  signal?: AbortSignal,
): Promise<T> {
  const viewport = resolveAgentViewport(requestedViewport)
  const budget = new AgentBrowserOperation(20_000, signal)
  const host = contents.hostWebContents
  // Offscreen agent windows have no embedded webview to resize. Their CDP
  // viewport is independent from the user's Browser panel.
  const backgroundThrottling = contents.getBackgroundThrottling()
  const token = randomUUID()
  let operationError: unknown
  let operationFailed = false
  let operationResult: T | undefined
  const cleanupErrors: unknown[] = []
  const expiresAt = Date.now() + 6_000
  const findView = `Array.from(document.querySelectorAll('webview')).find((node) => {
    try { return node.getWebContentsId() === ${contents.id}; } catch { return false; }
  })`
  try {
    contents.setBackgroundThrottling(false)
    if (host && !host.isDestroyed()) {
      await budget.run('prepare embedded browser surface', () => host.executeJavaScript(`(() => {
        if (Date.now() >= ${expiresAt}) return;
        const view = ${findView};
        if (!view) return;
        if (view.__tidecodeAgentViewport) throw new Error('Previous browser viewport cleanup has not completed.');
        const bounds = view.getBoundingClientRect();
        const scale = Math.min(1, bounds.width / ${viewport.width}, bounds.height / ${viewport.height});
        if (scale <= 0) throw new Error('The browser panel has no rendering surface. Open the Browser panel and retry.');
        const properties = ['width', 'height', 'minWidth', 'minHeight', 'opacity', 'visibility', 'transform', 'transformOrigin'];
        view.__tidecodeAgentViewport = {
          token: ${JSON.stringify(token)},
          style: Object.fromEntries(properties.map((key) => [key, view.style[key]]))
        };
        view.style.width = '${viewport.width}px';
        view.style.height = '${viewport.height}px';
        view.style.minWidth = '${viewport.width}px';
        view.style.minHeight = '${viewport.height}px';
        // Keep the whole guest surface inside its panel so Chromium paints it.
        // This host transform does not change guest CSS pixels or screenshot size.
        view.style.transformOrigin = 'top left';
        view.style.transform = 'scale(' + scale + ')';
        view.style.opacity = '1';
        view.style.visibility = 'visible';
        view.getBoundingClientRect();
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`), () => undefined)
    }
    operationResult = await withBrowserProtocol(contents, async (send) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await send('Runtime.evaluate', {
        expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
        awaitPromise: true,
      })
      return await action(send, viewport)
    }, budget)
  } catch (error) {
    operationError = error
    operationFailed = true
  } finally {
    // Cleanup has a separate bounded budget and never replays an input action.
    // The token prevents a delayed host cleanup from changing a later operation.
    try {
      if (host && !host.isDestroyed()) {
        await new AgentBrowserOperation(2_000).run('restore embedded browser surface', () => host.executeJavaScript(`(() => {
          const view = ${findView};
          const saved = view?.__tidecodeAgentViewport;
          if (!saved || saved.token !== ${JSON.stringify(token)}) return;
          for (const [key, value] of Object.entries(saved.style)) view.style[key] = value;
          delete view.__tidecodeAgentViewport;
        })()`), () => undefined)
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      if (!contents.isDestroyed()) {
        if (host && !host.isDestroyed()) {
          // Restore an embedded user webview if this scope was used for one.
          await withBrowserProtocol(contents, (cleanup) => cleanup('Emulation.clearDeviceMetricsOverride'), new AgentBrowserOperation(2_000))
        } else if (operationFailed) {
          // Hidden AI tabs retain their selected emulated viewport after a
          // successful read. On failure, restore the last committed viewport.
          const previousViewport = getAgentViewport(contents)
          if (previousViewport.width !== viewport.width || previousViewport.height !== viewport.height) {
            await withBrowserProtocol(contents, (cleanup) => cleanup('Emulation.setDeviceMetricsOverride', {
              width: previousViewport.width,
              height: previousViewport.height,
              deviceScaleFactor: 1,
              mobile: false,
            }), new AgentBrowserOperation(2_000))
          }
        }
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (!contents.isDestroyed()) {
    contents.setBackgroundThrottling(backgroundThrottling)
  }
  if (cleanupErrors.length) {
    const cleanupMessage = cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join('; ')
    const originalMessage = operationError instanceof Error ? operationError.message + ' ' : ''
    throw new Error(originalMessage + 'Browser viewport cleanup failed: ' + cleanupMessage)
  }
  if (operationFailed) throw operationError
  return operationResult as T
}

export async function captureAgentPageInViewport(send: CdpSend, viewport: AgentViewport = DEFAULT_AGENT_VIEWPORT) {
  // The surface is sized for the entire viewport before capture. Chromium
  // supplies the frame; there is no load-completion wait or arbitrary sleep.
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 },
  }) as { data?: string }
  if (!result.data) throw new Error('Chromium returned no browser screenshot.')
  const png = Buffer.from(result.data, 'base64')
  if (png.length < 24 || png.readUInt32BE(16) !== viewport.width
    || png.readUInt32BE(20) !== viewport.height) {
    throw new Error(`Chromium did not capture the requested ${viewport.width}x${viewport.height} viewport.`)
  }
  return png
}

export async function captureAgentPage(contents: WebContents) {
  return withAgentViewport(contents, captureAgentPageInViewport)
}
