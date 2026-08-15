export const TIDECODE_INSTALL_UPDATE_ARGUMENT = '--tidecode-install-update'

export function hasExternalUpdateRequest(argv: readonly string[]): boolean {
  return argv.includes(TIDECODE_INSTALL_UPDATE_ARGUMENT)
}
