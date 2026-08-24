import xtermModule from "@xterm/xterm/lib/xterm.js";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const { Terminal } = xtermModule;

const DEFAULT_SCREEN_COLS = 220;
const DEFAULT_SCREEN_ROWS = 50;
const SCREEN_SCROLLBACK_ROWS = 1_000;

export interface TerminalScreenRow {
  row: number;
  text: string;
}

export interface TerminalScreenSnapshot {
  activeBuffer: "alternate" | "normal";
  cols: number;
  cursorColumn: number;
  cursorRow: number;
  revision: number;
  rows: number;
  visibleRows: TerminalScreenRow[];
}

export interface TerminalScreenModelOptions {
  cols?: number;
  rows?: number;
}

function clampDimension(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value as number)));
}

function getVisibleRows(terminal: XtermTerminal) {
  const buffer = terminal.buffer.active;
  const rows: TerminalScreenRow[] = [];
  const viewportStart = buffer.viewportY;

  for (let index = 0; index < terminal.rows; index += 1) {
    const text = buffer.getLine(viewportStart + index)?.translateToString(true) ?? "";
    rows.push({ row: index + 1, text });
  }

  const firstContentIndex = rows.findIndex((row) => row.text.length > 0);
  if (firstContentIndex < 0) {
    return [];
  }

  let lastContentIndex = rows.length - 1;
  while (lastContentIndex > firstContentIndex && rows[lastContentIndex]?.text.length === 0) {
    lastContentIndex -= 1;
  }

  return rows.slice(firstContentIndex, lastContentIndex + 1);
}

export class TerminalScreenModel {
  private readonly terminal: XtermTerminal;
  private pendingWrite: Promise<void> = Promise.resolve();
  private revision = 0;

  constructor(options: TerminalScreenModelOptions = {}) {
    this.terminal = new Terminal({
      cols: clampDimension(options.cols, DEFAULT_SCREEN_COLS, 20, 400),
      convertEol: false,
      disableStdin: true,
      rows: clampDimension(options.rows, DEFAULT_SCREEN_ROWS, 6, 200),
      scrollback: SCREEN_SCROLLBACK_ROWS,
    });
  }

  write(chunk: string) {
    if (chunk.length === 0) {
      return this.pendingWrite;
    }

    const writeOperation = this.pendingWrite.then(
      () => new Promise<void>((resolve) => {
        this.terminal.write(chunk, () => {
          this.revision += 1;
          resolve();
        });
      }),
    );
    this.pendingWrite = writeOperation.catch(() => undefined);
    return writeOperation;
  }

  resize(cols: number, rows: number) {
    this.terminal.resize(
      clampDimension(cols, DEFAULT_SCREEN_COLS, 20, 400),
      clampDimension(rows, DEFAULT_SCREEN_ROWS, 6, 200),
    );
    this.revision += 1;
  }

  reset() {
    this.terminal.reset();
    this.revision += 1;
  }

  getActiveBufferType(): TerminalScreenSnapshot["activeBuffer"] {
    return this.terminal.buffer.active.type;
  }

  getSnapshot(): TerminalScreenSnapshot {
    const buffer = this.terminal.buffer.active;
    return {
      activeBuffer: buffer.type,
      cols: this.terminal.cols,
      cursorColumn: buffer.cursorX + 1,
      cursorRow: buffer.cursorY + 1,
      revision: this.revision,
      rows: this.terminal.rows,
      visibleRows: getVisibleRows(this.terminal),
    };
  }

  dispose() {
    this.terminal.dispose();
  }
}

export function formatTerminalScreenForModel(snapshot: TerminalScreenSnapshot) {
  const header = `screen: ${snapshot.activeBuffer} ${snapshot.cols}x${snapshot.rows}`;
  const rows = snapshot.visibleRows.length === 0
    ? ["(blank screen)"]
    : snapshot.visibleRows.map((row) => `${row.row}: ${row.text}`);
  return [
    header,
    ...rows,
    `cursor: row ${snapshot.cursorRow}, column ${snapshot.cursorColumn}`,
  ].join("\n");
}

export function formatTerminalScreenForDisplay(snapshot: TerminalScreenSnapshot) {
  const rows = snapshot.visibleRows.length === 0
    ? ["(blank screen)"]
    : snapshot.visibleRows.map((row) => row.text);
  return ["Interactive terminal screen", ...rows].join("\n");
}
