const { ipcRenderer } = require('electron')
ipcRenderer.send('fixture-preload-ready')

ipcRenderer.on('browser:openAgentTab', (_event, input) => {
  ipcRenderer.send('fixture-open-received')
  const webview = document.createElement('webview')
  webview.setAttribute('partition', 'persist:tidecode-browser')
  webview.setAttribute('src', input.url)
  webview.setAttribute('style', 'display:flex;width:440px;height:340px;opacity:0;')
  webview.addEventListener('dom-ready', () => {
    ipcRenderer.send('fixture-webview-loaded')
  }, { once: true })
  document.body.appendChild(webview)
  ipcRenderer.on('browser:terminateAgentTab', (_event, close) => {
    if (close.tabId === input.tabId) webview.remove()
  })
})
