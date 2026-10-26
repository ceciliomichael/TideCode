# tools.browser.open

Open an HTTP(S) URL in a hidden, isolated AI-owned Chromium browser window. The AI may choose its viewport in CSS pixels using optional `width` and `height` (integers 1–4096). The default is **1440 × 900**. Set both dimensions when a specific responsive size matters, e.g. `await tools.browser.open({url:"http://localhost:3000",width:390,height:844})`. An omitted dimension uses its default. The browser preview fits the resulting screenshot inside the panel without stretching or cropping and never resizes the user's panel.

An existing same-URL, same-viewport AI-owned tab is reused unless `new_tab:true`; requesting another resolution creates a separate AI tab rather than silently resizing an existing one. Keep the tab_id for future read/interact calls. Later browser.read calls without dimensions preserve this tab's active resolution. User-owned tabs are not created or changed by browser.open.
