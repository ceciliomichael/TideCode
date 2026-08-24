export const MAX_TERMINAL_REPLAY_BUFFER_LENGTH = 300_000

export function appendTerminalReplayBuffer(
  currentBuffer: string,
  output: string,
  maximumLength = MAX_TERMINAL_REPLAY_BUFFER_LENGTH,
) {
  if (!output) return currentBuffer
  if (!Number.isInteger(maximumLength) || maximumLength <= 0) {
    throw new Error('Terminal replay buffer limit must be a positive integer.')
  }
  if (output.length >= maximumLength) return output.slice(-maximumLength)

  const retainedCurrentLength = Math.min(currentBuffer.length, maximumLength - output.length)
  const retainedCurrent = retainedCurrentLength === currentBuffer.length
    ? currentBuffer
    : currentBuffer.slice(currentBuffer.length - retainedCurrentLength)
  return retainedCurrent + output
}

export function boundTerminalReplayBuffer(
  buffer: string,
  maximumLength = MAX_TERMINAL_REPLAY_BUFFER_LENGTH,
) {
  if (!Number.isInteger(maximumLength) || maximumLength <= 0) {
    throw new Error('Terminal replay buffer limit must be a positive integer.')
  }
  return buffer.length <= maximumLength ? buffer : buffer.slice(-maximumLength)
}
