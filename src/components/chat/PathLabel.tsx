import { memo } from 'react'
import { getPathBasename } from '../../lib/pathPresentation'
import { Tooltip } from '../Tooltip'

interface PathLabelProps {
  path: string
  className?: string
}

function getParentPath(path: string) {
  const normalizedPath = path.replace(/\\/g, '/')
  const basename = getPathBasename(normalizedPath)

  if (basename === normalizedPath) {
    return ''
  }

  return normalizedPath.slice(0, normalizedPath.length - basename.length)
}

export const PathLabel = memo(function PathLabel({ path, className = '' }: PathLabelProps) {
  const normalizedPath = path.replace(/\\/g, '/')
  const basename = getPathBasename(normalizedPath)
  const parentPath = getParentPath(normalizedPath)

  if (parentPath.length === 0) {
    return (
      <Tooltip content={normalizedPath} side="top" noWrap triggerClassName="min-w-0 flex-1">
        <span className={`block min-w-0 flex-1 truncate ${className}`.trim()}>{basename}</span>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={normalizedPath} side="top" noWrap triggerClassName="min-w-0 flex-1">
      <span className={`inline-flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap ${className}`.trim()}>
        <span className="min-w-0 shrink truncate text-left">{parentPath}</span>
        <span className="shrink-0 truncate">{basename}</span>
      </span>
    </Tooltip>
  )
})
