import WebSocket from 'ws'
const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json())
const page = targets.find(t => t.type === 'page' && t.title === 'TideCode')
if (!page?.webSocketDebuggerUrl) throw new Error('TideCode debugger target not found')
const waitOpen = s => new Promise((resolve, reject) => { s.once('open', resolve); s.once('error', reject) })
async function evaluate(expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await waitOpen(socket)
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP timeout')), 5000)
    socket.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id === 1) { clearTimeout(timer); resolve(m) } })
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  socket.close()
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || 'Renderer evaluation failed')
  return result.result?.result?.value
}
const state = await evaluate("(async()=>({remoteType:typeof window.tidecodeRemoteHost,historyType:typeof window.tidecodeHistory,directConversationCount:(await window.tidecodeHistory.listConversations()).length,status:await window.tidecodeRemoteHost.getStatus(),bodyText:document.body.innerText.slice(0,160)}))()")
console.log('rendererRemote=' + state.remoteType)
console.log('rendererHistory=' + state.historyType)
console.log('directConversations=' + state.directConversationCount)
console.log('hostEnabled=' + state.status.enabled)
console.log('bodyHasTideCode=' + /TideCode/i.test(state.bodyText))
if (!state.status.remoteUrl) throw new Error('Missing LAN remote URL')
const remoteBaseUrl = new URL(state.status.urls.find(url => url.includes('127.0.0.1')) ?? `http://127.0.0.1:${state.status.port}`)
const remote = new WebSocket(`ws://${remoteBaseUrl.host}/remote/ws`, { headers: { Origin: remoteBaseUrl.origin } })
const readyPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Remote ready timeout')), 5000)
  remote.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.kind === 'ready') { clearTimeout(timer); resolve(m) } })
})
await waitOpen(remote)
await readyPromise
const rpc = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Remote RPC timeout')), 10000)
  remote.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.kind === 'rpc-result' && m.id === 'smoke-list') { clearTimeout(timer); resolve(m) } })
  const request = JSON.stringify({ protocolVersion: 1, kind: 'rpc', id: 'smoke-list', namespace: 'tidecodeHistory', method: 'listConversations', args: [] })
  remote.send(request)
})
if (!rpc.ok) throw new Error(rpc.error || 'Remote RPC failed')
console.log('remoteRpc=true')
console.log('remoteConversations=' + rpc.result.length)
remote.close()