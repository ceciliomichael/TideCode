import { useEffect, useState } from 'react'
import { getFileExtension } from '../../../lib/filePathUtils'
import { resolveRelativePath } from '../../../lib/markdown'

interface WorkspaceMarkdownImageProps {
  alt?: string
  currentRelativePath?: string
  src?: string
  workspaceRootPath?: string | null
}

function isRemoteOrEmbeddedSource(source: string) {
  return /^(?:https?:|data:|blob:|\/\/)/iu.test(source)
}

function decodeImagePath(source: string) {
  try {
    return decodeURIComponent(source)
  } catch {
    return source
  }
}

function createSvgDataUrl(content: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
}

export function WorkspaceMarkdownImage({
  alt,
  currentRelativePath,
  src,
  workspaceRootPath,
}: WorkspaceMarkdownImageProps) {
  const [resolvedSource, setResolvedSource] = useState<string | undefined>(src)

  useEffect(() => {
    let isCancelled = false

    if (!src || isRemoteOrEmbeddedSource(src) || !workspaceRootPath) {
      setResolvedSource(src)
      return () => {
        isCancelled = true
      }
    }

    const [pathPart] = src.split(/[?#]/u)
    const resolvedRelativePath = resolveRelativePath(currentRelativePath, decodeImagePath(pathPart))
    setResolvedSource(undefined)

    void window.tidecodeWorkspace
      .readFile({
        relativePath: resolvedRelativePath,
        workspaceRootPath,
      })
      .then((result) => {
        if (isCancelled) {
          return
        }

        if (result.status === 'missing') {
          setResolvedSource(src)
          return
        }

        const extension = getFileExtension(resolvedRelativePath)
        const svgSource = extension === '.svg' && !result.previewDataUrl && !result.isBinary
          ? createSvgDataUrl(result.content)
          : undefined
        setResolvedSource(result.previewDataUrl ?? svgSource ?? src)
      })
      .catch(() => {
        if (!isCancelled) {
          setResolvedSource(src)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [currentRelativePath, src, workspaceRootPath])

  return (
    <img
      src={resolvedSource}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="my-4 block max-h-[40rem] max-w-5xl rounded-2xl border border-border bg-surface object-contain"
    />
  )
}
