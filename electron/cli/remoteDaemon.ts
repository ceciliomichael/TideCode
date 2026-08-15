import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import type { CliSessionState } from './types'
import { colors, renderBoxMessage } from './renderer'
import { startApiKeyChatStream } from '../chat/apiKey/runtime'
import { startCodexChatStream } from '../chat/codex/runtime'
import type { ChatStreamEventTarget } from '../chat/shared/runtimeStreamEvents'
import { TIDECODE_VERSION } from '../appVersion'

export async function startRemoteRelayDaemon(
  state: CliSessionState,
  preferredPort = 38472,
): Promise<void> {
  const sessionToken = `tc_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const port = preferredPort

  const server = http.createServer((req, res) => {
    // Basic CORS & pairing handshake
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          workspace: state.workspaceRootPath,
          model: state.modelId,
          provider: state.providerId,
          version: TIDECODE_VERSION,
        }),
      )
      return
    }

    if (req.url === '/api/prompt' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body)
          const authHeader = req.headers.authorization
          if (authHeader !== `Bearer ${sessionToken}` && payload.token !== sessionToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized pairing token' }))
            return
          }

          const promptText = payload.prompt?.trim()
          if (!promptText) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Prompt is required' }))
            return
          }

          // Setup SSE streaming response
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })

          const eventTarget: ChatStreamEventTarget = {
            send: (_channel: string, eventPayload: unknown) => {
              res.write(`data: ${JSON.stringify(eventPayload)}\n\n`)
            },
            isDestroyed: () => res.writableEnded,
          }

          const userMessage = {
            id: randomUUID(),
            role: 'user' as const,
            content: promptText,
            timestamp: Date.now(),
          }

          state.messages.push(userMessage)

          const streamInput: StartChatStreamInput = {
            agentContextRootPath: state.workspaceRootPath,
            chatMode: state.chatMode,
            contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
            conversationId: state.conversationId,
            messages: state.messages,
            modelId: state.modelId,
            providerId: state.providerId,
            reasoningEffort: state.reasoningEffort,
            terminalExecutionMode: state.terminalExecutionMode,
          }

          if (state.providerId === 'codex') {
            await startCodexChatStream(eventTarget, streamInput, () => {
              res.write('data: [DONE]\n\n')
              res.end()
            })
          } else {
            await startApiKeyChatStream(eventTarget, streamInput, () => {
              res.write('data: [DONE]\n\n')
              res.end()
            })
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const pairingUrl = `http://localhost:${port}/#token=${sessionToken}`
      const infoText = [
        `Remote Relay Daemon is active and listening on port ${colors.bold}${port}${colors.reset}`,
        `Workspace: ${colors.cyan}${state.workspaceRootPath}${colors.reset}`,
        `Pairing Token: ${colors.yellow}${sessionToken}${colors.reset}`,
        `Mobile Pairing URL: ${colors.brightCyan}${pairingUrl}${colors.reset}`,
        ``,
        `Send prompts to: POST http://localhost:${port}/api/prompt`,
        `Press ${colors.bold}Ctrl+C${colors.reset} in terminal to stop the remote daemon.`,
      ].join('\n')

      renderBoxMessage('TideCode Remote Relay', infoText, colors.green)
      resolve()
    })
  })
}
