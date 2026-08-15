// The packaged terminal CLI runs under a bundled console Node runtime rather
// than the GUI Electron executable. Electron-only branches are guarded by
// process.versions.electron, so these exports intentionally remain absent.
export const BrowserWindow = undefined
export const app = undefined
export const clipboard = undefined
export const net = undefined
export const shell = undefined
export const webContents = undefined
export default undefined
