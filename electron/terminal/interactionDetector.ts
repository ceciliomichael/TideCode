import { stripTerminalControlSequences } from "./aiTranscript";

export type TerminalInteractionKind =
  | "confirmation"
  | "line_input"
  | "screen"
  | "key_input";

export interface TerminalInteractionDetection {
  confidence: "high" | "medium";
  hint: string;
  kind: TerminalInteractionKind;
  reason: string;
}

const MAX_DETECTOR_TAIL_LENGTH = 2_048;
const ANSI_ESCAPE = String.fromCharCode(27);
const ALTERNATE_SCREEN_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[(?:\\?|>)(?:47|1047|1049)[hl]`, "u");
const CURSOR_MODE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[\\?(?:25|1000|1002|1003|1006)[hl]`, "u");
const CONFIRMATION_PATTERN = /(?:\[[ \t]*[yYnN](?:[ \t]*\/[ \t]*[yYnN])?[ \t]*\]|\([ \t]*(?:y[ \t]*\/[ \t]*n|n[ \t]*\/[ \t]*y|yes[ \t]*\/[ \t]*no|no[ \t]*\/[ \t]*yes)[ \t]*\))/iu;
const CONTINUATION_PATTERN = /(?:continue|proceed|overwrite|replace|delete|remove|install|accept|confirm|retry)[^\r\n?]{0,100}\?[ \t]*(?:\[[^\]]+\])?/iu;
const PRESS_ENTER_PATTERN = /(?:press|hit|type)[ \t]+(?:the[ \t]+)?(?:enter|return)[ \t]*(?:key|to[ \t]+continue)?/iu;
const PASSWORD_PATTERN = /(?:password|passphrase)[ \t]*:/iu;
const LINE_INPUT_PATTERN = /(?:enter|input|choice|selection|value)[^\r\n:]{0,80}:[ \t]*$/iu;

function compactHint(value: string) {
  const visible = stripTerminalControlSequences(value)
    .replace(/\r/g, "\n")
    .split(/\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .pop() ?? "Interactive terminal input appears to be required.";
  return visible.length > 240 ? visible.slice(-240) : visible;
}

export class TerminalInteractionDetector {
  private detectedAlternateScreen = false;
  private tail = "";

  reset() {
    this.detectedAlternateScreen = false;
    this.tail = "";
  }

  observe(
    chunk: string,
    interactionMode: "auto" | "interactive" | "non_interactive" = "auto",
  ): TerminalInteractionDetection | null {
    if (chunk.length === 0) {
      return null;
    }

    if (ALTERNATE_SCREEN_PATTERN.test(chunk)) {
      this.detectedAlternateScreen = true;
    }

    const visibleChunk = stripTerminalControlSequences(chunk);
    this.tail = `${this.tail}${visibleChunk}`.slice(-MAX_DETECTOR_TAIL_LENGTH);

    const recentText = this.tail;
    if (CONFIRMATION_PATTERN.test(recentText) || CONTINUATION_PATTERN.test(recentText)) {
      return {
        confidence: "high",
        hint: compactHint(recentText),
        kind: "confirmation",
        reason: "confirmation_prompt",
      };
    }

    if (PRESS_ENTER_PATTERN.test(recentText)) {
      return {
        confidence: "high",
        hint: compactHint(recentText),
        kind: "key_input",
        reason: "press_enter_prompt",
      };
    }

    if (PASSWORD_PATTERN.test(recentText)) {
      return {
        confidence: "high",
        hint: "A password or passphrase prompt is waiting for input.",
        kind: "line_input",
        reason: "password_prompt",
      };
    }

    if (LINE_INPUT_PATTERN.test(recentText)) {
      return {
        confidence: "medium",
        hint: compactHint(recentText),
        kind: "line_input",
        reason: "line_input_prompt",
      };
    }

    if (
      this.detectedAlternateScreen ||
      (interactionMode === "interactive" && CURSOR_MODE_PATTERN.test(chunk))
    ) {
      return {
        confidence: "medium",
        hint: "An interactive terminal screen is active.",
        kind: "screen",
        reason: "interactive_screen_control_sequence",
      };
    }

    return null;
  }
}
