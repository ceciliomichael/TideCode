# tools.browser.interact

Act inside a TideCode browser tab. Prefer an element_ref from tools.browser.read({ view: "combined" }) for reliable DOM-based targets, but use screenshot coordinates for canvas and purely visual controls.

Pass the tab_id from browser.open or browser.tabs on every call. A URL is needed ONLY for the explicit navigate action; it is neither required nor appropriate for click, fill, type, key, scroll, back, forward, or reload. All actions operate on the existing live tab. Do not call browser.open between interactions. Reading or interacting with the existing tab should not refresh the page. Avoid the reload action unless the user requests a refresh.

Actions:
- click: element_ref, OR x and y in the 1280x720 CSS viewport. Optional button: left, right, middle.
- fill: element_ref plus text. Scrolls the target into view and replaces editable field contents.
- type: text at the currently focused element.
- key: a single key or Ctrl/Shift/Alt/Meta+key. Supports Enter, Tab, Escape, arrows and other common keys.
- scroll: delta_x and delta_y (optional x/y position, defaults to center).
- navigate: absolute HTTP(S) url.
- back, forward, reload: browser navigation.

Example: await tools.browser.interact({ tab_id: "id", action: "click", element_ref: "el-...-..." })
Example: await tools.browser.interact({ tab_id: "id", action: "fill", element_ref: "el-...-...", text: "example" })

Element references are scoped to the last structure read. Detached, hidden, disabled, or obscured elements cause an error rather than clicking a different target. After navigation or substantial DOM updates, read again.
