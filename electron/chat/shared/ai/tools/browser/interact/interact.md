# tools.browser.interact

Act inside a TideCode browser tab. Use an element_ref from tools.browser.read({ view: "combined" }) or view: "structure" to click a target or fill a field.

Pass the tab_id from browser.open or browser.tabs on every call. A URL is needed ONLY for the explicit navigate action; it is neither required nor appropriate for click, fill, type, key, scroll, back, forward, or reload. All actions operate on the existing live tab. Do not call browser.open between interactions. Reading or interacting with the existing tab should not refresh the page. Avoid the reload action unless the user requests a refresh.

Actions:
- click: required element_ref. Referenced targets scroll into view immediately, independent of page smooth-scrolling styles. Optional button: left, right, middle.
- fill: element_ref plus text. Scrolls the target into view and replaces editable field contents.
- type: text at the currently focused element.
- key: a single key or Ctrl/Shift/Alt/Meta+key. Supports Enter, Tab, Escape, arrows and other common keys.
- scroll: delta_x and delta_y (optional x/y scroll anchor inside the viewport, defaults to center).
- navigate: absolute HTTP(S) url.
- back, forward, reload: browser navigation.

Example: await tools.browser.interact({ tab_id: "id", action: "click", element_ref: "el-...-..." })
Example: await tools.browser.interact({ tab_id: "id", action: "fill", element_ref: "el-...-...", text: "example" })

No resolution arguments are needed for interaction. The tab remembers its latest successful read dimensions. An off-screen reference is valid and automatically scrolls its target into view before clicking or filling. Hidden and covered controls must first be revealed or uncovered.

Element references are scoped to the last structure read. Detached, hidden, disabled, or obscured elements cause an error rather than clicking a different target. After navigation or substantial DOM updates, read again.

Target scrolling, measurement, and input dispatch share one viewport scope. Fill requests are validated before input is dispatched. These actions preserve the current document unless the page itself navigates in response. For a stable result after a single action, use browser.read with the same tab_id and width/height to inspect it at the same resolution; omitting dimensions resets the read to 1280x720. No URL is needed. Timed-out actions are not replayed automatically. Check current state before deciding whether an input action should be retried.


## Local action and observation sequences

For animations, games, short-lived notifications, and other temporary states, pass `steps` instead of a top-level `action`. The desktop executes the ordered steps locally in one call, holding the same tab queue, viewport, and protocol scope throughout. There is no model round trip or viewport restoration between steps. The tab uses its latest successful read dimensions, or 1280x720 before its first read. Use browser.read to choose a different resolution before starting the sequence.

```js
await tools.browser.interact({
  tab_id: "game-tab",
  steps: [
    { action: "read", view: "visual", label: "Before jump" },
    { action: "key", key: "Space" },
    { action: "wait", duration_ms: 100 },
    { action: "read", view: "visual", label: "During jump" },
    { action: "wait", duration_ms: 600 },
    { action: "read", view: "combined", label: "After landing" }
  ]
});
```

Steps support the input/navigation actions above, plus:
- `wait`: required `duration_ms`, an integer from 0 to 5000. Waits are relative to the completion of the previous step. The total requested wait across a sequence cannot exceed 5000ms.
- `read`: `view` is `combined` (default), `visual`, or `structure`; optional `offset` and `limit` follow browser.read pagination. Sequence reads do not include annotations. Use visual captures for the fastest observation of an animation; structure extraction takes additional time.
- Optional `label`: up to 120 characters, used to identify the step's observation.

A sequence has 1 to 32 steps and up to 8 screenshots, totaling at most 8 MiB of PNG bytes. Existing protocol operations retain their 20-second budget, six-second command limits, and bounded cleanup. Sequence timing begins after viewport preparation. Results report completed steps, elapsed milliseconds, and each read's start/completion times. Screenshot details report the request interval; they do not claim an exact compositor frame timestamp. These are real captures with processing overhead, not frame-perfect recording. Waits and rendering may take longer than requested.

Every captured image is delivered to the model in order with its label and timing. With an active conversation, all images are saved and their relative paths are listed in the result; the existing image disclosure previews the last captured image.

The entire sequence is validated before input. On a runtime failure it stops immediately, returns earlier completed observations and identifies the failed step. Earlier actions are not rolled back, and actions are never automatically retried. A failed input may already have reached the page. Inspect the state before retrying. Viewport cleanup still runs. If viewport setup or cleanup itself fails, the tool reports that error.

Element references from an earlier browser.read may be used in a sequence. A `structure` or `combined` read replaces the reference snapshot, invalidating older references. Put such a read after actions that use preexisting references, or split the sequence so you can inspect and use the new references. Visual reads preserve references. Navigation can start loading asynchronously; sequence reads do not wait for load completion, and references expire on navigation. Use a new read and a subsequent call when the next action depends on an unknown page state. Never infer that an animation failed just because the character has returned to its starting position in the last capture; compare intermediate frames.
