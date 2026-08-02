export async function fetchGitHub(input: string, init?: RequestInit): Promise<Response> {
  if (typeof process !== 'undefined' && Boolean(process.versions.electron)) {
    const { net } = await import('electron')
    return net.fetch(input, init)
  }

  return fetch(input, init)
}
