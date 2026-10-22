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

Target scrolling, measurement, and input dispatch share one viewport scope. Fill requests are validated before input is dispatched. These actions preserve the current document unless the page itself navigates in response. After an action, use browser.read with the same tab_id and width/height to inspect the result at the same resolution; omitting dimensions resets the read to 1280x720. No URL is needed. Timed-out actions are not replayed automatically. Check current state before deciding whether an input action should be retried.
