const PUBLIC_GITHUB_APP_CLIENT_ID = 'Iv23liiDyRPBgz74SA7r'

export function getGitHubAppClientId() {
  const configuredClientId = process.env.TIDECODE_GITHUB_APP_CLIENT_ID?.trim()
  return configuredClientId || PUBLIC_GITHUB_APP_CLIENT_ID
}
