# tools.browser.devtools

Inspect Chromium diagnostics for the specified tab_id. **User-owned tabs are read-only** and permit only `console`, `network`, or `performance`, not JavaScript evaluation or custom CDP calls. AI-owned tabs additionally allow `evaluate` (JavaScript expression) and `cdp` (advanced domain.method with optional parameters).

Examples: `await tools.browser.devtools({tab_id:"id",action:"console"})` and `await tools.browser.devtools({tab_id:"id",action:"network",limit:30})`.

Diagnostics record only events collected while the CDP session is attached. Standard output redacts recognized secrets; never print raw authentication tokens into tool results. Evaluation and custom CDP are powerful capabilities; use them only on AI-owned tabs. Use browser.read for normal page inspection.
