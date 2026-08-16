import { TideCodeRunServiceServer } from './server'

const service = new TideCodeRunServiceServer()

async function main() {
  try {
    await service.start()
    process.on('SIGINT', () => { void service.close().finally(() => process.exit(0)) })
    process.on('SIGTERM', () => { void service.close().finally(() => process.exit(0)) })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') process.exit(0)
    console.error('[run-service] Failed to start:', error)
    process.exit(1)
  }
}

void main()
