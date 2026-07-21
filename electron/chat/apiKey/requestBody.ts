export function createExtraBodyFetch(extraBody: Record<string, unknown>, fetchImplementation: typeof fetch = fetch) {
  if (Object.keys(extraBody).length === 0) {
    return fetchImplementation
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') {
      return fetchImplementation(input, init)
    }

    try {
      const requestBody = JSON.parse(init.body) as unknown
      if (typeof requestBody !== 'object' || requestBody === null || Array.isArray(requestBody)) {
        return fetchImplementation(input, init)
      }

      return fetchImplementation(input, {
        ...init,
        body: JSON.stringify({
          ...(requestBody as Record<string, unknown>),
          ...extraBody,
        }),
      })
    } catch {
      return fetchImplementation(input, init)
    }
  }
}
