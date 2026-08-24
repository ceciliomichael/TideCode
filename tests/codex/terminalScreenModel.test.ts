import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTerminalScreenForModel,
  TerminalScreenModel,
} from "../../electron/terminal/screenModel";

const ESC = "\u001B";

test("terminal screen model renders redraws as the visible screen", async () => {
  const model = new TerminalScreenModel({ cols: 20, rows: 5 });

  try {
    await model.write("progress 1");
    await model.write(`\rprogress 2`);

    const snapshot = model.getSnapshot();
    assert.deepEqual(snapshot.visibleRows, [{ row: 1, text: "progress 2" }]);
    assert.equal(snapshot.cursorRow, 1);
    assert.equal(snapshot.cursorColumn, 11);
  } finally {
    model.dispose();
  }
});

test("terminal screen model follows cursor movement and alternate screens", async () => {
  const model = new TerminalScreenModel({ cols: 30, rows: 6 });

  try {
    await model.write(`first${ESC}[2;4Hsecond`);
    const normalSnapshot = model.getSnapshot();
    assert.equal(model.getActiveBufferType(), "normal");
    assert.equal(normalSnapshot.activeBuffer, "normal");
    assert.deepEqual(normalSnapshot.visibleRows, [
      { row: 1, text: "first" },
      { row: 2, text: "   second" },
    ]);

    await model.write(`${ESC}[?1049h${ESC}[2J${ESC}[HChoose\r\n> Install`);
    const alternateSnapshot = model.getSnapshot();
    assert.equal(model.getActiveBufferType(), "alternate");
    assert.equal(alternateSnapshot.activeBuffer, "alternate");
    assert.deepEqual(alternateSnapshot.visibleRows, [
      { row: 1, text: "Choose" },
      { row: 2, text: "> Install" },
    ]);
    assert.match(formatTerminalScreenForModel(alternateSnapshot), /screen: alternate 30x6/u);
    assert.match(formatTerminalScreenForModel(alternateSnapshot), /2: > Install/u);
  } finally {
    model.dispose();
  }
});
