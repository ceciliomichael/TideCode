# tools.browser.interact

Act only in AI-owned tabs. A tab returned by browser.open is AI-owned; use browser.tabs only if ownership is unknown. User-owned tabs are read-only. All coordinates use the tab's existing CSS viewport, not the scaled TideCode panel. Coordinate input needs no observation ID or preceding read.

Choose the smallest suitable action:
- `click`, `hover`, `double_click`: `element_ref` or viewport `x, y`.
- `drag`: a single straight segment with `x, y, to_x, to_y`.
- `stroke`: a continuous connected line using `points: [{x,y}, ...]` (2–256 points). It presses once, moves through every point, then releases once. Use this for drawing circles, curves and handwriting rather than many separate drags.
- `fill` with `element_ref, text`, `type` into the focused field, `key`, or `scroll`.
- `steps`: 1–32 ordered input, `wait`, `wait_for` or `read` operations in a single tab. Do not mix `steps` with a top-level action. `wait` accepts `ms` or `duration_ms` (not both), with total waits limited to five seconds.

Example: `await tools.browser.interact({tab_id:"id",action:"stroke",points:[{x:400,y:300},{x:450,y:270},{x:500,y:300}]})`.

Await operations on the same tab in order. Do not use Promise.all for input to the same page. Inspect once to establish a target when necessary, batch related actions, then use browser.read to verify the final visual outcome. Avoid repeated screenshots after every movement; a successful input-dispatch report is not proof of page success. Never blindly retry submissions or uncertain actions.

For page observations use `tools.browser.read({tab_id})`; for workspace file contents use `tools.read({path})`. Navigation, history and reload belong to browser.navigate, not browser.interact. The live Browser panel preview updates independently of tool completion; it is not an additional observation sent to the model. Single actions and sequences return the actual current viewport resolution. Screenshots captured by a sequence contain the last known AI cursor position. Straight drags and strokes use spaced, paced mouse movements to avoid gaps; a separate drag releases its mouse button and does not connect to the next drag.
