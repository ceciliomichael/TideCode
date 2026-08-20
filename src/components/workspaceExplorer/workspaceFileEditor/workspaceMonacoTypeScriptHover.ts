import type { Monaco } from '@monaco-editor/react'
import type { editor, Position } from 'monaco-editor'

interface TypeScriptDisplayPart {
  text: string
}

interface TypeScriptQuickInfo {
  displayParts?: readonly TypeScriptDisplayPart[]
  documentation?: readonly TypeScriptDisplayPart[]
  tags?: readonly {
    name: string
    text?: readonly TypeScriptDisplayPart[] | string
  }[]
}

interface TypeScriptQuickInfoWorker {
  getQuickInfoAtPosition(fileName: string, position: number): Promise<TypeScriptQuickInfo | undefined>
}

type TypeScriptWorkerFactory = (resource: editor.ITextModel['uri']) => Promise<TypeScriptQuickInfoWorker>
type TypeScriptLanguageId = 'javascript' | 'typescript'

const workerFactoryPromises = new WeakMap<object, Map<TypeScriptLanguageId, Promise<TypeScriptWorkerFactory>>>()

function getWorkspaceMonacoTypeScriptWorkerFactory(
  monaco: Monaco,
  languageId: TypeScriptLanguageId,
) {
  let runtimeFactories = workerFactoryPromises.get(monaco as object)
  if (!runtimeFactories) {
    runtimeFactories = new Map()
    workerFactoryPromises.set(monaco as object, runtimeFactories)
  }

  const cached = runtimeFactories.get(languageId)
  if (cached) return cached

  const getWorker = languageId === 'typescript'
    ? monaco.languages.typescript.getTypeScriptWorker
    : monaco.languages.typescript.getJavaScriptWorker
  const factoryPromise = getWorker()
    .then((factory: unknown) => factory as TypeScriptWorkerFactory)
    .catch((error: unknown) => {
      runtimeFactories?.delete(languageId)
      throw error
    })
  runtimeFactories.set(languageId, factoryPromise)
  return factoryPromise
}

export interface WorkspaceMonacoTypeScriptTooltipData {
  displayText: string
  documentation: string
  languageId: 'javascript' | 'typescript'
  tags: string[]
}

function displayPartsToString(parts: readonly TypeScriptDisplayPart[] | undefined) {
  return parts?.map((part) => part.text).join('') ?? ''
}

function formatTag(tag: NonNullable<TypeScriptQuickInfo['tags']>[number]) {
  const text = typeof tag.text === 'string' ? tag.text : displayPartsToString(tag.text)
  return '@' + tag.name + (text ? ' ' + text : '')
}

export function formatWorkspaceMonacoModuleTooltipDisplayText(
  typeScriptDisplayText: string,
  quotedModuleSpecifier: string,
) {
  const trimmed = typeScriptDisplayText.trim()
  if (!trimmed) return 'module ' + quotedModuleSpecifier

  for (const quote of ['"', "'"] as const) {
    const marker = quote + 'file:///workspace/'
    const startIndex = trimmed.indexOf(marker)
    if (startIndex < 0) continue
    const endIndex = trimmed.indexOf(quote, startIndex + marker.length)
    if (endIndex < 0) continue
    return trimmed.slice(0, startIndex) + quotedModuleSpecifier + trimmed.slice(endIndex + 1)
  }

  const workspaceUriMarker = 'file:///workspace/'
  const workspaceUriStart = trimmed.indexOf(workspaceUriMarker)
  if (workspaceUriStart >= 0) {
    let workspaceUriEnd = workspaceUriStart + workspaceUriMarker.length
    while (workspaceUriEnd < trimmed.length && !/[\s)\]}>,;]/u.test(trimmed[workspaceUriEnd])) {
      workspaceUriEnd += 1
    }
    const unquotedSpecifier = quotedModuleSpecifier.slice(1, -1)
    return trimmed.slice(0, workspaceUriStart) + unquotedSpecifier + trimmed.slice(workspaceUriEnd)
  }

  return /^module\b/u.test(trimmed)
    ? trimmed
    : 'module ' + quotedModuleSpecifier
}

export async function getWorkspaceMonacoTypeScriptTooltip(
  monaco: Monaco,
  model: editor.ITextModel,
  position: Position,
): Promise<WorkspaceMonacoTypeScriptTooltipData | null> {
  const languageId = model.getLanguageId()
  if (languageId !== 'typescript' && languageId !== 'javascript') return null

  const workerFactory = await getWorkspaceMonacoTypeScriptWorkerFactory(monaco, languageId)
  if (model.isDisposed()) return null
  const worker = await workerFactory(model.uri)
  if (model.isDisposed()) return null

  const quickInfo = await worker.getQuickInfoAtPosition(
    model.uri.toString(),
    model.getOffsetAt(position),
  )
  if (!quickInfo || model.isDisposed()) return null

  const displayText = displayPartsToString(quickInfo.displayParts).trim()
  const documentation = displayPartsToString(quickInfo.documentation).trim()
  const tags = quickInfo.tags?.map(formatTag).filter(Boolean) ?? []
  if (!displayText && !documentation && tags.length === 0) return null

return { displayText, documentation, languageId, tags }
}
