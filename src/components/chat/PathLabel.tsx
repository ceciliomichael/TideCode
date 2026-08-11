import { memo } from 'react'
import { getPathBasename } from '../../lib/pathPresentation'
import { Tooltip } from '../Tooltip'

interface PathLabelProps {
  path: string
  className?: string
}

export const PathLabel = memo(function PathLabel({ path, className = '' }: PathLabelProps) {
  const normalizedPath = path.replace(/\\/g, '/')
  const basename = getPathBasename(normalizedPath)

  return (
    <Tooltip content={normalizedPath} side="top" noWrap triggerClassName="min-w-0 flex-1">
      <span
        aria-label={normalizedPath}
        className={`block min-w-0 flex-1 truncate text-left ${className}`.trim()}
      >
        {basename}
      </span>
    </Tooltip>
  )
})
