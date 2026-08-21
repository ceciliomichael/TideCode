import { resolveRunServiceBuildIdFromEnvironment } from './buildIdentity'
import { TideCodeRunServiceServer } from './server'

let shuttingDown = false
let service: TideCodeRunServiceServer

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  void service.close().finally(() => process.exit(0))
}

service = new TideCodeRunServiceServer({
  buildId: resolveRunServiceBuildIdFromEnvironment(),
  onShutdownRequested: shutdown,
})

async function main() {
  try {
    await service.start()
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') process.exit(0)
    console.error('[run-service] Failed to start:', error)
    process.exit(1)
  }
}

void main()
