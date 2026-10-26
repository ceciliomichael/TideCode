# tools.browser.navigate

Navigate an existing **AI-owned** browser tab. User-owned tabs are read-only. Use `browser.open` to create an AI tab; use `browser.navigate` to change its page or browser history. This is the only browser tool for direct navigation. `browser.interact` is limited to mouse, keyboard and scrolling and sequences do not accept navigation actions.

`action`: `goto` (requires `url`), `back`, `forward`, `reload`, or `stop`. Only `goto` accepts a URL; URLs must be safe HTTP(S) destinations. Optional `wait_until`: `none` (dispatch only), `commit` (main-frame navigation), `domcontentloaded` (default), or `load`. Optional `timeout_ms` is 100–20000 milliseconds (default 12000). A page-load milestone does not guarantee client-side UI readiness; use `browser.read` or an interaction sequence with `wait_for` to confirm application state. Example: `await tools.browser.navigate({tab_id:"id",action:"goto",url:"http://localhost:3000/settings",wait_until:"domcontentloaded"})`.

The result directly reports the prior URL, current/final observed URL, wait milestone or incomplete load, and actual page title when available, as structured plain text. No result fallback transformation. Cancellation and timeout fail clearly without retrying the navigation. Redirects may change the final URL; always inspect it rather than assuming the requested URL loaded.
