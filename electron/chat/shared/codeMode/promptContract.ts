/**
 * Model-facing contract for the Code Mode worker.
 *
 * This describes the Code Mode execution contract without constraining the
 * JavaScript runtime available inside its dedicated worker.
 */
export const CODE_MODE_EXECUTION_CONTRACT = [
  'Code Mode is a temporary asynchronous JavaScript program running in its dedicated worker.',
  'Use ordinary JavaScript and the available runtime APIs for control flow, calculation, parsing, and shaping returned data.',
  'Await every `tools.*` call. If you need its data, assign it and return a concise JSON-compatible value; for an action-only call, await it before ending the program. Do not use a bare `tools.*` expression as the program result.',
  'For workspace files, search, terminal work, memory, plans, or connected services, prefer the matching documented `tools.*` function because it returns structured results and respects the application workflow.',
].join(' ')
