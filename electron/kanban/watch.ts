import type { WebContents } from 'electron'
import path from 'node:path'

interface KanbanBoardWatcherState {
  subscribers: Set<number>
}

const watcherStates = new Map<string, KanbanBoardWatcherState>()
const senderRoots = new Map<number, string>()
const registeredSenders = new Set<number>()

function normalizeWorkspaceRootPath(workspaceRootPath: string) {
  return path.resolve(workspaceRootPath.trim())
}

function getKanbanBoardWatcherState(workspaceRootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const existingState = watcherStates.get(normalizedRootPath)
  if (existingState) {
    return existingState
  }

  const nextState: KanbanBoardWatcherState = {
    subscribers: new Set(),
  }

  watcherStates.set(normalizedRootPath, nextState)
  return nextState
}

function removeKanbanBoardSubscriber(senderId: number, workspaceRootPath?: string) {
  const normalizedRootPath = workspaceRootPath ? normalizeWorkspaceRootPath(workspaceRootPath) : senderRoots.get(senderId)
  if (!normalizedRootPath) {
    return
  }

  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    senderRoots.delete(senderId)
    return
  }

  state.subscribers.delete(senderId)
  senderRoots.delete(senderId)

  if (state.subscribers.size === 0) {
    watcherStates.delete(normalizedRootPath)
  }
}

function addKanbanBoardSubscriber(sender: WebContents, workspaceRootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const previousRootPath = senderRoots.get(sender.id)
  if (previousRootPath && previousRootPath !== normalizedRootPath) {
    removeKanbanBoardSubscriber(sender.id, previousRootPath)
  }

  const state = getKanbanBoardWatcherState(normalizedRootPath)
  state.subscribers.add(sender.id)
  senderRoots.set(sender.id, normalizedRootPath)

  if (!registeredSenders.has(sender.id)) {
    registeredSenders.add(sender.id)
    sender.once('destroyed', () => {
      const currentRootPath = senderRoots.get(sender.id)
      if (currentRootPath) {
        removeKanbanBoardSubscriber(sender.id, currentRootPath)
      }
      registeredSenders.delete(sender.id)
    })
  }
}

export function subscribeKanbanBoardChanges(sender: WebContents, workspaceRootPath: string) {
  addKanbanBoardSubscriber(sender, workspaceRootPath)
}

export function unsubscribeKanbanBoardChanges(senderId: number, workspaceRootPath?: string) {
  removeKanbanBoardSubscriber(senderId, workspaceRootPath)
}

export async function notifyKanbanBoardChange(workspaceRootPath: string) {
  if (typeof process === 'undefined' || !process.versions.electron) {
    return
  }

  try {
    const { BrowserWindow } = await import('electron')
    const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
    for (const targetWindow of BrowserWindow.getAllWindows()) {
      if (targetWindow.isDestroyed()) {
        continue
      }

      targetWindow.webContents.send('kanban:changed', {
        workspaceRootPath: normalizedRootPath,
      })
    }
  } catch (error) {
    console.error('Failed to notify kanban board change', error)
  }
}

export function disposeKanbanBoardWatchers() {
  watcherStates.clear()
  senderRoots.clear()
  registeredSenders.clear()
}
