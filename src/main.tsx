import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installDesktopRemoteBridge } from './remote/desktopBridge'
import { installRemoteBrowserBridge, isRemoteBrowserRuntime } from './remote/webBridge'
import { readThemeColor } from './lib/themeColorTokens'

function renderBootstrapError(error: unknown) {
  const rootElement = document.getElementById('root')
  if (!rootElement) return
  const message = error instanceof Error ? error.message : String(error)
  const resolvedTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const background = readThemeColor('--color-background', resolvedTheme)
  const foreground = readThemeColor('--color-foreground', resolvedTheme)
  const mutedForeground = readThemeColor('--color-muted-foreground', resolvedTheme)
  const surface = readThemeColor('--color-surface', resolvedTheme)
  const border = readThemeColor('--color-border', resolvedTheme)
  rootElement.innerHTML = ''
  const container = document.createElement('main')
  container.style.cssText = `min-height:100vh;display:grid;place-items:center;padding:32px;background:${background};color:${foreground};font-family:system-ui,sans-serif`
  const card = document.createElement('section')
  card.style.cssText = `max-width:640px;width:100%;padding:24px;border:1px solid ${border};border-radius:12px;background:${surface}`
  const title = document.createElement('h1')
  title.textContent = 'Unable to connect to TideCode'
  title.style.cssText = 'font-size:20px;margin:0 0 12px'
  const body = document.createElement('p')
  body.textContent = message
  body.style.cssText = `line-height:1.5;margin:0;color:${mutedForeground}`
  card.append(title, body)
  container.append(card)
  rootElement.append(container)
}

async function bootstrap() {
  try {
    if (isRemoteBrowserRuntime()) {
      await installRemoteBrowserBridge()
    } else {
      installDesktopRemoteBridge()
    }

    const { default: App } = await import('./App.tsx')
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  } catch (error) {
    console.error('Unable to initialize TideCode.', error)
    renderBootstrapError(error)
  }
}

void bootstrap()
