import { net } from 'electron'
import type { Readable } from 'node:stream'
import { buildLatestReleaseRequestUrl, type ReleaseRequest } from './githubReleaseService'

const UPDATE_REQUEST_TIMEOUT_MS = 20_000

export const requestLatestReleaseWithElectron: ReleaseRequest = () =>
  new Promise((resolve, reject) => {
    let isSettled = false
    const timeoutId = setTimeout(() => {
      if (isSettled) {
        return
      }

      isSettled = true
      request.abort()
      reject(new Error('UPDATE_REQUEST_TIMEOUT'))
    }, UPDATE_REQUEST_TIMEOUT_MS)

    const settle = (callback: () => void) => {
      if (isSettled) {
        return
      }

      isSettled = true
      clearTimeout(timeoutId)
      callback()
    }

    const request = net.request({
      method: 'GET',
      url: buildLatestReleaseRequestUrl(),
    })

    request.setHeader('Accept', 'application/vnd.github+json')
    request.setHeader('Cache-Control', 'no-cache, no-store, max-age=0')
    request.setHeader('Pragma', 'no-cache')
    request.setHeader('User-Agent', 'TideCode-update-checker')
    request.setHeader('X-GitHub-Api-Version', '2022-11-28')
    request.on('error', (error) => settle(() => reject(error)))
    request.on('response', (response) => {
      const responseStream = response as unknown as Readable
      let responseBody = ''
      responseStream.setEncoding('utf8')
      responseStream.on('data', (chunk) => {
        responseBody += String(chunk)
      })
      responseStream.on('error', (error) => settle(() => reject(error)))
      responseStream.on('end', () => {
        settle(() => {
          const statusCode = response.statusCode ?? 0
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`GitHub could not be reached right now (HTTP ${statusCode}).`))
            return
          }

          try {
            resolve(JSON.parse(responseBody) as unknown)
          } catch {
            reject(new Error('GitHub returned an invalid release response.'))
          }
        })
      })
    })
    request.end()
  })
