/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  tidecodeBrowser: import('../src/types/browser').TideCodeBrowserApi
  tidecodeBrowserDevTools: import('../src/types/browser').TideCodeBrowserDevToolsApi
  tidecodeBrowserFavicons: import('../src/types/browser').TideCodeBrowserFaviconsApi
  ipcRenderer: import('electron').IpcRenderer
  tidecodeApp: import('../src/types/chat').TideCodeAppApi
  tidecodeChat: import('../src/types/chat').TideCodeChatApi
  tidecodeGit: import('../src/types/chat').TideCodeGitApi
  tidecodeHistory: import('../src/types/chat').TideCodeHistoryApi
  tidecodeKanban: import('../src/types/chat').TideCodeKanbanApi
  tidecodeModels: import('../src/types/chat').TideCodeModelsApi
  tidecodeMcp: import('../src/types/mcp').TideCodeMcpApi
  tidecodeProviders: import('../src/types/chat').TideCodeProvidersApi
  tidecodeRuns: import('../src/types/chat').TideCodeRunsApi
  tidecodeSkills: import('../src/types/skills').TideCodeSkillsApi
  tidecodeSettings: import('../src/types/chat').TideCodeSettingsApi
  tidecodeUpdates: import('../src/types/updates').TideCodeUpdatesApi
  tidecodeFileDrop: {
    getPathForFile: (file: File) => string
  }
  tidecodeClipboard: {
    clear: () => Promise<void>
    isWorkspaceFilesCurrent: (input: {
      mode: 'copy' | 'cut'
      relativePaths: string[]
      workspaceRootPath: string
    }) => Promise<boolean>
    readFiles: () => Promise<string[]>
    readWorkspaceFiles: () => Promise<{
      entries: Array<{
        isDirectory: boolean
        relativePath: string
      }>
      mode: 'copy' | 'cut'
      relativePaths: string[]
      workspaceRootPath: string
    } | null>
    startWorkspaceFileDrag: (input: {
      mode: 'copy' | 'cut'
      relativePaths: string[]
      workspaceRootPath: string
    }) => Promise<void>
    writeWorkspaceFiles: (input: {
      mode: 'copy' | 'cut'
      relativePaths: string[]
      workspaceRootPath: string
    }) => Promise<void>
  }
  tidecodeTerminal: import('../src/types/chat').TideCodeTerminalApi
  tidecodeWorkspace: import('../src/types/chat').TideCodeWorkspaceApi
  tidecodeRemoteHost: import('../src/remote/protocol').TideCodeRemoteHostBridgeApi
}
