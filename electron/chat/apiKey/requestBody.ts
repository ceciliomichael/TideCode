export type RequestBodyTransform = (requestBody: Record<string, unknown>) => Record<string, unknown>

export function createExtraBodyFetch(
  extraBody: Record<string, unknown>,
  fetchImplementation: typeof fetch = fetch,
  transform?: RequestBodyTransform,
) {
  if (Object.keys(extraBody).length === 0 && !transform) {
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

      const mergedBody = {
        ...(requestBody as Record<string, unknown>),
        ...extraBody,
      }
      return fetchImplementation(input, {
        ...init,
        body: JSON.stringify(transform ? transform(mergedBody) : mergedBody),
      })
    } catch {
      return fetchImplementation(input, init)
    }
  }
}
