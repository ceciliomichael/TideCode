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
  ipcRenderer: import('electron').IpcRenderer
  tidecodeChat: import('../src/types/chat').TideCodeChatApi
  tidecodeGit: import('../src/types/chat').TideCodeGitApi
  tidecodeHistory: import('../src/types/chat').TideCodeHistoryApi
  tidecodeKanban: import('../src/types/chat').TideCodeKanbanApi
  tidecodeModels: import('../src/types/chat').TideCodeModelsApi
  tidecodeMcp: import('../src/types/mcp').TideCodeMcpApi
  tidecodeProviders: import('../src/types/chat').TideCodeProvidersApi
  tidecodeSkills: import('../src/types/skills').TideCodeSkillsApi
  tidecodeSettings: import('../src/types/chat').TideCodeSettingsApi
  tidecodeFileDrop: {
    getPathForFile: (file: File) => string
  }
  tidecodeClipboard: {
    readFiles: () => Promise<string[]>
  }
  tidecodeTerminal: import('../src/types/chat').TideCodeTerminalApi
  tidecodeWorkspace: import('../src/types/chat').TideCodeWorkspaceApi
}
