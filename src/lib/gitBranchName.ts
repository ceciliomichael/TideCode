const UNSUPPORTED_BRANCH_INPUT_CHARACTERS = /[^A-Za-z0-9_.\-/\s]/g

export function sanitizeGitBranchInput(value: string) {
  return value.replace(UNSUPPORTED_BRANCH_INPUT_CHARACTERS, '')
}

export function normalizeGitBranchName(value: string) {
  return sanitizeGitBranchInput(value).trim().replace(/\s+/g, '-')
}
