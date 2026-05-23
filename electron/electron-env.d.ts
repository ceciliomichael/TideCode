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
  echosphereChat: import('../src/types/chat').EchosphereChatApi
  echosphereGit: import('../src/types/chat').EchosphereGitApi
  echosphereHistory: import('../src/types/chat').EchosphereHistoryApi
  echosphereKanban: import('../src/types/chat').EchosphereKanbanApi
  echosphereModels: import('../src/types/chat').EchosphereModelsApi
  echosphereMcp: import('../src/types/mcp').EchosphereMcpApi
  echosphereProviders: import('../src/types/chat').EchosphereProvidersApi
  echosphereSkills: import('../src/types/skills').EchosphereSkillsApi
  echosphereSettings: import('../src/types/chat').EchosphereSettingsApi
  echosphereFileDrop: {
    getPathForFile: (file: File) => string
  }
  echosphereClipboard: {
    readFiles: () => Promise<string[]>
  }
  echosphereTerminal: import('../src/types/chat').EchosphereTerminalApi
  echosphereWorkspace: import('../src/types/chat').EchosphereWorkspaceApi
}
