import type { Server } from 'node:http'

interface ListenWithPortFallbackOptions {
  allowIncrement: boolean
  host: string
  maxPort: number
  preferredPort: number
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

function listenOnPort(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onListening = () => {
      cleanup()
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function listenWithPortFallback(server: Server, options: ListenWithPortFallbackOptions) {
  let port = options.preferredPort

  while (port <= options.maxPort) {
    try {
      await listenOnPort(server, port, options.host)
      return port
    } catch (error) {
      if (!options.allowIncrement || !isAddressInUseError(error) || port >= options.maxPort) {
        throw error
      }
      port += 1
    }
  }

  throw new Error(`No available remote port from ${options.preferredPort} through ${options.maxPort}.`)
}
