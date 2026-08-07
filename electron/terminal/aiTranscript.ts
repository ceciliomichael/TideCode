const ANSI_ESCAPE = "\u001B";
const TERMINAL_BELL = "\u0007";

export const AI_TERMINAL_SEGMENT_LENGTH = 200;
export const MAX_AI_TERMINAL_TRANSCRIPT_LENGTH = 300_000;

const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_PATTERN = new RegExp(
  `${ANSI_ESCAPE}\\][^${TERMINAL_BELL}${ANSI_ESCAPE}]*(?:${TERMINAL_BELL}|${ANSI_ESCAPE}\\\\)`,
  "g",
);
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}[@-Z\\-_]`, "g");
const GENERIC_COMPLETION_MARKER_PATTERN = /__EDONE_[a-z0-9_]+__:-?\d+/iu;

export interface AiTerminalSegment {
  continuation: boolean;
  lineNumber: number;
  text: string;
}

export interface AiTerminalTranscriptSummary {
  availableLineCount: number;
  characterCount: number;
  firstAvailableLine: number;
  hasPartialLine: boolean;
  lastAvailableLine: number;
  lineCount: number;
  revision: number;
  truncated: boolean;
}

export interface AiTerminalTranscriptReadResult {
  hasMore: boolean;
  lines: AiTerminalSegment[];
  summary: AiTerminalTranscriptSummary;
  requestedOffset: number;
  requestedLimit: number;
  skippedEvictedLines: boolean;
}

interface TerminalCommandMetadata {
  command: string;
  marker: string;
}

type EscapeState = "csi" | "esc" | "normal" | "osc" | "oscEsc";

export function stripTerminalControlSequences(value: string) {
  return value
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(
        (code >= 0 && code <= 8) ||
        code === 11 ||
        (code >= 26 && code <= 31) ||
        code === 127
      );
    })
    .join("");
}

function splitIntoSegments(value: string) {
  const characters = Array.from(value);
  if (characters.length === 0) {
    return [""];
  }

  const segments: string[] = [];
  for (let index = 0; index < characters.length; index += AI_TERMINAL_SEGMENT_LENGTH) {
    segments.push(characters.slice(index, index + AI_TERMINAL_SEGMENT_LENGTH).join(""));
  }
  return segments;
}

function parseCsiParameters(value: string) {
  const normalized = value.startsWith("?") || value.startsWith(">") ? value.slice(1) : value;
  return normalized
    .split(";")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part > 0 ? part : 1));
}

function readLineText(line: string[]) {
  return line.join("").replace(/[ \t]+$/u, "");
}

export class AiTerminalTranscript {
  private commandMetadata: TerminalCommandMetadata | null = null;
  private carriageReturnPending = false;
  private currentLine: string[] = [];
  private cursor = 0;
  private escapeParameters = "";
  private escapeState: EscapeState = "normal";
  private lastCommittedLineWasBlank = false;
  private retainedCharacterCount = 0;
  private revision = 0;
  private segments: AiTerminalSegment[] = [];
  private totalLineCount = 0;

  reset(metadata: TerminalCommandMetadata) {
    this.commandMetadata = metadata;
    this.carriageReturnPending = false;
    this.currentLine = [];
    this.cursor = 0;
    this.escapeParameters = "";
    this.escapeState = "normal";
    this.lastCommittedLineWasBlank = false;
    this.retainedCharacterCount = 0;
    this.revision += 1;
    this.segments = [];
    this.totalLineCount = 0;
  }

  append(chunk: string) {
    for (const character of chunk) {
      this.consumeCharacter(character);
    }
    if (chunk.length > 0) {
      this.revision += 1;
    }
  }

  finalize() {
    if (readLineText(this.currentLine).length > 0) {
      this.commitCurrentLine();
    }
  }

  getSummary(): AiTerminalTranscriptSummary {
    const partialSegments = this.getPartialSegments();
    const firstStoredLine = this.segments[0]?.lineNumber ?? null;
    const firstAvailableLine =
      firstStoredLine ?? (partialSegments.length > 0 ? this.totalLineCount + 1 : 0);
    const lastAvailableLine =
      this.segments[this.segments.length - 1]?.lineNumber ??
      (partialSegments.length > 0 ? this.totalLineCount + partialSegments.length : 0);

    return {
      availableLineCount: this.segments.length + partialSegments.length,
      characterCount: this.retainedCharacterCount + partialSegments.join("").length,
      firstAvailableLine,
      hasPartialLine: partialSegments.length > 0,
      lastAvailableLine,
      lineCount: this.totalLineCount + partialSegments.length,
      revision: this.revision,
      truncated: firstAvailableLine > 1,
    };
  }

  read(offset: number, limit: number): AiTerminalTranscriptReadResult {
    const normalizedOffset = Math.max(1, Math.floor(offset));
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const partialSegments = this.getPartialSegments();
    const visibleSegments = [
      ...this.segments,
      ...partialSegments.map((text, index) => ({
        continuation: index > 0,
        lineNumber: this.totalLineCount + index + 1,
        text,
      })),
    ];
    const selectedLines = visibleSegments.filter(
      (segment) => segment.lineNumber >= normalizedOffset,
    ).slice(0, normalizedLimit);
    const summary = this.getSummary();

    return {
      hasMore: selectedLines.length > 0
        ? selectedLines[selectedLines.length - 1].lineNumber < summary.lastAvailableLine
        : normalizedOffset <= summary.lastAvailableLine,
      lines: selectedLines,
      requestedLimit: normalizedLimit,
      requestedOffset: normalizedOffset,
      skippedEvictedLines: summary.firstAvailableLine > normalizedOffset,
      summary,
    };
  }

  getPreview(maxSegments = 8, maxCharacters = 1_000) {
    const partialSegments = this.getPartialSegments();
    const visibleSegments = [
      ...this.segments,
      ...partialSegments.map((text, index) => ({
        continuation: index > 0,
        lineNumber: this.totalLineCount + index + 1,
        text,
      })),
    ];
    const preview = visibleSegments
      .slice(-maxSegments)
      .map((segment) => segment.text)
      .join("\n");
    return preview.length > maxCharacters ? preview.slice(-maxCharacters) : preview;
  }

  private consumeCharacter(character: string) {
    if (
      this.carriageReturnPending &&
      character !== "\n" &&
      character !== "\r"
    ) {
      this.currentLine = [];
      this.cursor = 0;
      this.carriageReturnPending = false;
    }

    if (this.escapeState === "esc") {
      this.escapeState = character === "["
        ? "csi"
        : character === "]"
          ? "osc"
          : "normal";
      this.escapeParameters = "";
      return;
    }

    if (this.escapeState === "osc") {
      if (character === TERMINAL_BELL) {
        this.escapeState = "normal";
      } else if (character === ANSI_ESCAPE) {
        this.escapeState = "oscEsc";
      }
      return;
    }

    if (this.escapeState === "oscEsc") {
      this.escapeState = character === "\\" ? "normal" : "osc";
      return;
    }

    if (this.escapeState === "csi") {
      if (character >= "@" && character <= "~") {
        this.handleCsi(this.escapeParameters, character);
        this.escapeState = "normal";
        this.escapeParameters = "";
      } else {
        this.escapeParameters += character;
      }
      return;
    }

    if (character === ANSI_ESCAPE) {
      this.escapeState = "esc";
      return;
    }

    if (character === "\n") {
      this.carriageReturnPending = false;
      this.commitCurrentLine();
      return;
    }

    if (character === "\r") {
      this.cursor = 0;
      this.carriageReturnPending = true;
      return;
    }

    if (character === "\b") {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }

    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return;
    }

    while (this.currentLine.length < this.cursor) {
      this.currentLine.push(" ");
    }
    this.currentLine[this.cursor] = character;
    this.cursor += 1;
  }

  private handleCsi(parameters: string, command: string) {
    const parsedParameters = parseCsiParameters(parameters);
    const amount = parsedParameters[0] ?? 1;

    if (command === "K") {
      if (parameters.startsWith("2")) {
        this.currentLine = [];
        this.cursor = 0;
      } else if (parameters.startsWith("1")) {
        this.currentLine = this.currentLine.slice(this.cursor);
        this.cursor = 0;
      } else {
        this.currentLine = this.currentLine.slice(0, this.cursor);
      }
      return;
    }

    if (command === "G" || command === "`") {
      this.cursor = Math.max(0, amount - 1);
      return;
    }

    if (command === "C" || command === "a") {
      this.cursor += amount;
      return;
    }

    if (command === "D") {
      this.cursor = Math.max(0, this.cursor - amount);
      return;
    }

    if (command === "P") {
      this.currentLine.splice(this.cursor, amount);
      return;
    }

    if (command === "@") {
      this.currentLine.splice(this.cursor, 0, ...Array.from({ length: amount }, () => " "));
    }
  }

  private commitCurrentLine() {
    const line = readLineText(this.currentLine);
    this.carriageReturnPending = false;
    this.currentLine = [];
    this.cursor = 0;
    this.commitLine(line);
  }

  private commitLine(rawLine: string) {
    const line = this.cleanLine(rawLine);
    if (line === null) {
      return;
    }
    if (line.length === 0) {
      if (this.lastCommittedLineWasBlank) {
        return;
      }
      this.lastCommittedLineWasBlank = true;
      this.appendSegments([""]);
      return;
    }

    this.lastCommittedLineWasBlank = false;
    this.appendSegments(splitIntoSegments(line));
  }

  private appendSegments(lines: string[]) {
    for (const [index, text] of lines.entries()) {
      this.totalLineCount += 1;
      this.segments.push({
        continuation: index > 0,
        lineNumber: this.totalLineCount,
        text,
      });
      this.retainedCharacterCount += text.length;
    }

    while (
      this.retainedCharacterCount > MAX_AI_TERMINAL_TRANSCRIPT_LENGTH &&
      this.segments.length > 0
    ) {
      const removed = this.segments.shift();
      if (removed) {
        this.retainedCharacterCount -= removed.text.length;
      }
    }
  }

  private cleanLine(rawLine: string): string | null {
    let line = rawLine.replace(/[ \t]+$/u, "");
    const metadata = this.commandMetadata;

    if (metadata) {
      const markerIndex = line.indexOf(metadata.marker);
      if (markerIndex >= 0) {
        const beforeMarker = line.slice(0, markerIndex).replace(/[ \t]+$/u, "");
        const looksLikeCommandEcho =
          beforeMarker.includes(metadata.command) ||
          /(?:echo|lastExitCode|errorlevel|\$\?)/iu.test(beforeMarker);
        if (looksLikeCommandEcho || beforeMarker.length === 0) {
          return null;
        }
        line = beforeMarker;
      }

      if (
        line.length > 0 &&
        /(?:lastExitCode|errorlevel|\$\?)/iu.test(line) &&
        (line.includes(metadata.command) || /(?:echo|__EDONE_)/iu.test(line))
      ) {
        return null;
      }
    }

    if (GENERIC_COMPLETION_MARKER_PATTERN.test(line)) {
      return null;
    }

    return line.replace(/[ \t]+$/u, "");
  }

  private getPartialSegments() {
    const line = this.cleanLine(readLineText(this.currentLine));
    return line && line.length > 0 ? splitIntoSegments(line) : [];
  }
}
