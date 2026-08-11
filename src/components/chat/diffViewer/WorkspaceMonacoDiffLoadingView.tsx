interface WorkspaceMonacoDiffLoadingViewProps {
  height: number
}

export function WorkspaceMonacoDiffLoadingView({ height }: WorkspaceMonacoDiffLoadingViewProps) {
  return (
    <div
      aria-hidden="true"
      className="w-full bg-surface"
      style={{ height: `${height}px` }}
    />
  )
}
