import { session, type Session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  BROWSER_SESSION_PARTITION,
  type BrowserPrivateTab,
} from '../../src/types/browser'

interface PrivateBrowserSession {
  ownerId: number
  projectKey: string
  partition: string
  session: Session
  tabs: Set<string>
  guests: Set<WebContents>
}

const privateSessions = new Map<Session, PrivateBrowserSession>()
const privateTabs = new Map<string, PrivateBrowserSession>()
const observedOwners = new Set<number>()

export function isNormalBrowserSession(browserSession: Session) {
  return browserSession === session.fromPartition(BROWSER_SESSION_PARTITION)
}

export function resolveBrowserSession(ownerId: number, partition: string) {
  if (partition === BROWSER_SESSION_PARTITION) {
    return session.fromPartition(BROWSER_SESSION_PARTITION)
  }
  for (const entry of privateSessions.values()) {
    if (entry.ownerId === ownerId && entry.partition === partition) {
      return entry.session
    }
  }
  throw new Error('The browser session is no longer available.')
}

export function ownsBrowserSession(ownerId: number, browserSession: Session) {
  return (
    isNormalBrowserSession(browserSession) ||
    privateSessions.get(browserSession)?.ownerId === ownerId
  )
}

async function clearPrivateSession(entry: PrivateBrowserSession) {
  privateSessions.delete(entry.session)
  for (const tabId of entry.tabs) {
    privateTabs.delete(tabId)
  }
  entry.tabs.clear()
  await Promise.all(
    Array.from(entry.guests, (guest) => {
      if (guest.isDestroyed()) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => guest.once('destroyed', resolve))
    }),
  )
  const results = await Promise.allSettled([
    entry.session.clearStorageData(),
    entry.session.clearCache(),
    entry.session.closeAllConnections(),
  ])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
}

export function trackPrivateBrowserGuest(guest: WebContents) {
  const entry = privateSessions.get(guest.session)
  if (
    !entry ||
    entry.ownerId !== guest.hostWebContents?.id ||
    entry.guests.has(guest)
  ) {
    return
  }
  entry.guests.add(guest)
  guest.once('destroyed', () => entry.guests.delete(guest))
}

function observeOwner(owner: WebContents) {
  if (observedOwners.has(owner.id)) {
    return
  }
  observedOwners.add(owner.id)
  const clearOwner = () => {
    for (const entry of privateSessions.values()) {
      if (entry.ownerId === owner.id) {
        void clearPrivateSession(entry).catch(console.error)
      }
    }
  }
  owner.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      clearOwner()
    }
  })
  owner.on('render-process-gone', clearOwner)
  owner.once('destroyed', () => {
    clearOwner()
    observedOwners.delete(owner.id)
  })
}

export function createIncognitoTab(
  owner: WebContents,
  projectKey: string,
): BrowserPrivateTab {
  if (typeof projectKey !== 'string' || !projectKey.trim()) {
    throw new Error('A browser project is required.')
  }
  observeOwner(owner)
  let entry = Array.from(privateSessions.values()).find(
    (candidate) =>
      candidate.ownerId === owner.id && candidate.projectKey === projectKey,
  )
  if (!entry) {
    const partition = `tidecode-browser-incognito-${randomUUID()}`
    entry = {
      ownerId: owner.id,
      projectKey,
      partition,
      session: session.fromPartition(partition, { cache: false }),
      tabs: new Set(),
      guests: new Set(),
    }
    privateSessions.set(entry.session, entry)
  }
  const tabId = randomUUID()
  entry.tabs.add(tabId)
  privateTabs.set(tabId, entry)
  return { tabId, partition: entry.partition }
}

export async function releaseIncognitoTab(ownerId: number, tabId: string) {
  const entry = privateTabs.get(tabId)
  if (!entry || entry.ownerId !== ownerId) {
    throw new Error('The incognito tab is no longer available.')
  }
  privateTabs.delete(tabId)
  entry.tabs.delete(tabId)
  if (entry.tabs.size === 0) {
    await clearPrivateSession(entry)
  }
}
