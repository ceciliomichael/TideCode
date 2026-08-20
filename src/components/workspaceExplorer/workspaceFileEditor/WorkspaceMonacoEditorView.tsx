import Editor, { type Monaco } from '@monaco-editor/react'
import { useCallback, useRef, useState, type ComponentProps } from 'react'
import type { editor } from 'monaco-editor'
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
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)
  const [mountedMonaco, setMountedMonaco] = useState<Monaco | null>(null)
  const handleMount = useCallback<NonNullable<ComponentProps<typeof Editor>['onMount']>>((editorInstance, monacoInstance) => {
    setMountedEditor(editorInstance)
    setMountedMonaco(monacoInstance)
    onMount(editorInstance, monacoInstance)
  }, [onMount])

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
        onMount={handleMount}
        options={options}
        path={modelPath}
        saveViewState
        theme={theme}
        value={value}
        width="100%"
      />
      <WorkspaceMonacoSearchPanel {...searchPanel} />
      <WorkspaceMonacoTooltipBridge
        containerRef={containerRef}
        editorInstance={mountedEditor}
        monacoInstance={mountedMonaco}
      />
    </div>
  )
}
