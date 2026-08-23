export interface SingleFlightTask<Result> {
  run: () => Promise<Result>
}

export function createSingleFlightTask<Result>(operation: () => Promise<Result>): SingleFlightTask<Result> {
  let operationPromise: Promise<Result> | null = null

  return {
    run() {
      operationPromise ??= Promise.resolve().then(operation)
      return operationPromise
    },
  }
}
