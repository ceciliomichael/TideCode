import Editor from '@monaco-editor/react'
import { useRef, type ComponentProps } from 'react'
import { WorkspaceMonacoLoadingView } from './WorkspaceMonacoLoadingView'
import {
  WorkspaceMonacoSearchPanel,
  type WorkspaceMonacoSearchPanelProps,
} from './WorkspaceMonacoSearchPanel'
import { WorkspaceMonacoTooltipBridge } from './WorkspaceMonacoTooltipBridge'
import './workspaceMonacoEnvironment'

interface WorkspaceMonacoEditorViewProps {
  beforeMount: NonNullable<ComponentProps<typeof Editor>['beforeMount']>
  handleChange: NonNullable<ComponentProps<typeof Editor>['onChange']>
  language: string
  modelPath: string
  onMount: NonNullable<ComponentProps<typeof Editor>['onMount']>
  options: NonNullable<ComponentProps<typeof Editor>['options']>
  searchPanel: WorkspaceMonacoSearchPanelProps
  theme: string
  value: string
}

export function WorkspaceMonacoEditorView({
  beforeMount,
  handleChange,
  language,
  modelPath,
  onMount,
  options,
  searchPanel,
  theme,
  value,
}: WorkspaceMonacoEditorViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div ref={containerRef} data-workspace-code-editor className="workspace-monaco-editor relative h-full min-h-0 w-full min-w-0 bg-surface">
      <Editor
        beforeMount={beforeMount}
        className="h-full min-h-0 w-full"
        height="100%"
        keepCurrentModel
        language={language}
        loading={<WorkspaceMonacoLoadingView />}
        onChange={handleChange}
        onMount={onMount}
        options={options}
        path={modelPath}
        saveViewState
        theme={theme}
        value={value}
        width="100%"
      />
      <WorkspaceMonacoSearchPanel {...searchPanel} />
      <WorkspaceMonacoTooltipBridge containerRef={containerRef} />
    </div>
  )
}
