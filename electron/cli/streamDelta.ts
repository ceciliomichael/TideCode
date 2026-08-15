/**
 * Normalizes provider text updates into append-only chunks.
 *
 * Most providers emit a new suffix on every text-delta event, while a few
 * OpenAI-compatible gateways emit the complete text accumulated so far. The
 * terminal presenter needs one contract so it never appends the same prefix
 * repeatedly when a gateway uses the latter form.
 */
export class TerminalStreamAccumulator {
  private value = ''

  append(update: string): string {
    if (!update) return ''

    if (update === this.value || (this.value.length > 0 && this.value.startsWith(update))) {
      return ''
    }

    if (this.value.length > 0 && update.startsWith(this.value)) {
      const suffix = update.slice(this.value.length)
      this.value = update
      return suffix
    }

    this.value += update
    return update
  }

  reset(): void {
    this.value = ''
  }

  get text(): string {
    return this.value
  }
}
